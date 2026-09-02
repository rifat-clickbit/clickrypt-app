/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { supabase } from '../services/supabaseClient';
import {
  generateKeyPair,
  generateTOTPCode,
  verifyTOTPCode,
  unprotectPrivateKey,
  canUnlockPrivateKey,
} from '../crypto/cryptoEngine';
import { withTimeout } from '../utils/withTimeout';
import { UserProfile, AppStartupState } from '../types';

interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  masterPassword: string | null;
  unlockedPgpKey: string | null;
  appMode: 'personal' | 'organization';
  setAppMode: (mode: 'personal' | 'organization') => void;
  check2FAStatus: (email: string) => Promise<{ requires2FA: boolean; secret?: string }>;
  verify2FACode: (secret: string, code: string) => boolean;
  toggleAccount2FA: (enable: boolean, secret?: string) => Promise<boolean>;
  login: (email: string, masterPassword: string) => Promise<{ success: boolean; error?: string }>;
  register: (name: string, email: string, masterPassword: string) => Promise<{ success: boolean; error?: string }>;
  unlockVault: (password: string) => Promise<boolean>;
  unlockWithBiometrics: () => Promise<boolean>;
  updateProfile: (
    name: string,
    email?: string,
    avatarUrl?: string
  ) => Promise<{ success: boolean; error?: string }>;
  switchModeAndLogout: (targetMode: 'personal' | 'organization') => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<{
    success: boolean;
    error?: string;
    failedStep?: string;
    failedTable?: string;
    warnings?: string[];
    legacyGroupsSkipped?: boolean;
  }>;
  refreshUserProfile: () => Promise<void>;
  isLoading: boolean;
  startupState: AppStartupState;
  credentialsResolved: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [masterPassword, setMasterPassword] = useState<string | null>(null);
  const [unlockedPgpKey, setUnlockedPgpKey] = useState<string | null>(null);
  const [appMode, setAppModeState] = useState<'personal' | 'organization'>('personal');
  const [isLoading, setIsLoading] = useState(true);
  const [startupState, setStartupState] = useState<AppStartupState>('INITIALIZING');
  const [credentialsResolved, setCredentialsResolved] = useState(false);

  useEffect(() => {
    loadSession();
  }, []);

  const setAppMode = async (mode: 'personal' | 'organization') => {
    setAppModeState(mode);
    await AsyncStorage.setItem('clickrypt_app_mode', mode);
  };

  const hydrateUserRecord = async (
    dbUser: any,
    providedPassword?: string | null
  ): Promise<UserProfile | null> => {
    if (!dbUser) return null;
    const cleanEmail = (dbUser.email || '').trim().toLowerCase();

    try {
      setStartupState('LOADING_CREDENTIALS');

      const [local2FAStr, savedAvatar, localProfileStr] = await Promise.all([
        AsyncStorage.getItem(`clickrypt_2fa_config_${cleanEmail}`),
        AsyncStorage.getItem(`clickrypt_avatar_${cleanEmail}`),
        AsyncStorage.getItem(`clickrypt_profile_${cleanEmail}`),
      ]);

      let is2FAActive = false;
      let saved2FASecret: string | undefined = undefined;
      if (local2FAStr) {
        try {
          const parsed = JSON.parse(local2FAStr);
          if (parsed.enabled) {
            is2FAActive = true;
            saved2FASecret = parsed.secret;
          }
        } catch {
          // ignore
        }
      }

      let savedName = cleanEmail.split('@')[0];
      if (localProfileStr) {
        try {
          const parsedProf = JSON.parse(localProfileStr);
          if (parsedProf.name) savedName = parsedProf.name;
        } catch {
          // ignore
        }
      }

      const has2FA =
        dbUser.data?.twoFactorEnabled !== undefined
          ? !!dbUser.data?.twoFactorEnabled
          : dbUser.two_factor_enabled !== undefined
          ? !!dbUser.two_factor_enabled
          : is2FAActive;
      const sec = dbUser.data?.twoFactorSecret || dbUser.two_factor_secret || saved2FASecret;
      const resolvedAvatar =
        dbUser.avatar_url || dbUser.data?.avatarUrl || savedAvatar || undefined;
      const resolvedName =
        dbUser.name || dbUser.data?.name || savedName || cleanEmail.split('@')[0];

      if (resolvedAvatar) {
        await AsyncStorage.setItem(`clickrypt_avatar_${cleanEmail}`, resolvedAvatar);
      }

      const rawEncKey =
        dbUser.data?.encryptedPrivateKey || dbUser.encrypted_private_key;

      const userObj: UserProfile = {
        id: dbUser.id,
        authId: dbUser.auth_id,
        email: dbUser.email,
        name: resolvedName,
        role: dbUser.data?.role || 'Owner',
        accountMode: dbUser.account_mode || 'personal',
        publicKey: dbUser.data?.publicKey || dbUser.public_key,
        encryptedPrivateKey: rawEncKey,
        avatarUrl: resolvedAvatar,
        twoFactorEnabled: has2FA,
        twoFactorSecret: sec,
      };

      if (dbUser.account_mode) {
        setAppModeState(dbUser.account_mode);
        await AsyncStorage.setItem('clickrypt_app_mode', dbUser.account_mode);
      }

      setStartupState('DECRYPTING_CREDENTIALS');
      let unlockedKey: string | null = null;
      let passwordToStore: string | null = null;
      const passToUse =
        providedPassword || (await AsyncStorage.getItem('clickrypt_master_password'));

      // Avoid re-running the expensive PGP KDF on every launch if we already
      // have a cached, unlocked copy of this exact encrypted key.
      const [cachedUnlocked, cachedKeySource] = await Promise.all([
        AsyncStorage.getItem('clickrypt_unlocked_pgp_key'),
        AsyncStorage.getItem('clickrypt_unlocked_key_source'),
      ]);

      if (rawEncKey && cachedUnlocked && cachedKeySource === rawEncKey) {
        unlockedKey = cachedUnlocked;
        passwordToStore = passToUse || (await AsyncStorage.getItem('clickrypt_master_password'));
        // Don't overwrite a real stored password with an empty string — that
        // would silently lock the user out of decryption on next launch.
        if (passwordToStore) {
          await AsyncStorage.setItem('clickrypt_master_password', passwordToStore);
        }
        console.log('[Auth] credentials reused from cache', { timestamp: Date.now() });
      } else if (passToUse && rawEncKey) {
        try {
          const unlocked = await unprotectPrivateKey(rawEncKey, passToUse);
          if (unlocked) {
            unlockedKey = unlocked;
            passwordToStore = passToUse;
            await AsyncStorage.setItem('clickrypt_unlocked_pgp_key', unlocked);
            await AsyncStorage.setItem('clickrypt_master_password', passToUse);
            await AsyncStorage.setItem('clickrypt_unlocked_key_source', rawEncKey);
            console.log('[Auth] credentials decrypted', { success: true, timestamp: Date.now() });
          }
        } catch {
          console.log('[Auth] credentials decrypted', { success: false, timestamp: Date.now() });
        }
      } else {
        console.log('[Auth] credentials decrypted', { success: !!passToUse, hasKey: !!rawEncKey, timestamp: Date.now() });
      }

      // Skip setUser if the profile data is unchanged. AuthContext replaces
      // the user OBJECT on every realtime echo / background rehydration even
      // though the actual fields are identical. Each new object identity
      // cascades into VaultContext (useCallback deps) and tears down realtime
      // subscriptions + re-fires the full vault sync. Shallow-comparing the
      // relevant fields breaks that cascade at its source.
      const prev = user;
      const isUnchanged =
        prev &&
        prev.id === userObj.id &&
        prev.email === userObj.email &&
        prev.name === userObj.name &&
        prev.role === userObj.role &&
        prev.accountMode === userObj.accountMode &&
        prev.publicKey === userObj.publicKey &&
        prev.encryptedPrivateKey === userObj.encryptedPrivateKey &&
        prev.avatarUrl === userObj.avatarUrl &&
        prev.twoFactorEnabled === userObj.twoFactorEnabled;
      if (!isUnchanged) {
        setUser(userObj);
      }
      setMasterPassword(passwordToStore);
      setUnlockedPgpKey(unlockedKey);
      setCredentialsResolved(true);
      await AsyncStorage.setItem('clickrypt_cached_user', JSON.stringify(userObj));

      return userObj;
    } catch {
      setCredentialsResolved(true);
      return null;
    }
  };

  const loadSession = async () => {
    try {
      setIsLoading(true);
      setCredentialsResolved(false);
      setStartupState('INITIALIZING');

      const [savedMode, savedPass, savedUnlocked, cachedUserStr] = await Promise.all([
        AsyncStorage.getItem('clickrypt_app_mode'),
        AsyncStorage.getItem('clickrypt_master_password'),
        AsyncStorage.getItem('clickrypt_unlocked_pgp_key'),
        AsyncStorage.getItem('clickrypt_cached_user'),
      ]);

      if (savedMode) setAppModeState(savedMode as 'personal' | 'organization');
      if (savedPass) setMasterPassword(savedPass);
      if (savedUnlocked) setUnlockedPgpKey(savedUnlocked);

      let cachedUser: UserProfile | null = null;
      if (cachedUserStr) {
        try {
          cachedUser = JSON.parse(cachedUserStr);
        } catch {
          cachedUser = null;
        }
      }

      // FAST PATH: render the cached user immediately so the UI is responsive
      // and the app does not appear frozen during auth/network/crypto setup.
      if (cachedUser?.email) {
        // If the cached profile is missing an avatar, try to fill it from the
        // per-email avatar cache so the picture shows right away.
        const cleanEmail = cachedUser.email.toLowerCase().trim();
        const savedAvatar = await AsyncStorage.getItem(`clickrypt_avatar_${cleanEmail}`);
        if (savedAvatar && !cachedUser.avatarUrl) {
          cachedUser = { ...cachedUser, avatarUrl: savedAvatar };
        }

        setUser(cachedUser);
        setCredentialsResolved(true);
        setStartupState('READY');
        setIsLoading(false);
      }

      // BACKGROUND: verify the live Supabase session and refresh profile data.
      const refreshSession = async () => {
        try {
          setStartupState('DATABASE_CONNECTING');
          const { data: sessionData } = await withTimeout(
            supabase.auth.getSession(),
            15000,
            'getSession'
          );

          if (sessionData.session?.user) {
            const userEmail = (sessionData.session.user.email || '').toLowerCase().trim();

            let dbUser: any | null = null;
            try {
              const { data, error } = await withTimeout(
                supabase.functions.invoke('user-profile-cache', { body: {} }),
                15000,
                'user-profile-cache'
              );
              if (!error && data?.dbUser) {
                dbUser = data.dbUser;
              }
            } catch (err) {
              console.warn('[Auth] user-profile-cache failed:', err);
            }

            if (!dbUser) {
              const { data: directDbUser } = await withTimeout(
                supabase
                  .from('users')
                  .select('*')
                  .eq('email', userEmail)
                  .maybeSingle(),
                15000,
                'loadSession users lookup'
              );
              dbUser = directDbUser;
            }

            if (dbUser) {
              setStartupState('DATABASE_READY');
              await hydrateUserRecord(dbUser, savedPass);
              setStartupState('READY');
            } else {
              await withTimeout(
                supabase.auth.signOut(),
                10000,
                'loadSession signOut'
              ).catch(() => {});
              await AsyncStorage.removeItem('clickrypt_cached_user');
              setUser(null);
              setCredentialsResolved(true);
              setStartupState('READY');
            }
          } else {
            // No live Supabase session. Keep the cached user so the app remains
            // usable offline and does not get stuck if the auth call fails.
            setStartupState('READY');
          }
        } catch (err) {
          console.warn('[Auth] background session refresh failed:', err);
          setStartupState('READY');
        } finally {
          setIsLoading(false);
        }
      };

      if (cachedUser?.email) {
        refreshSession(); // non-blocking
      } else {
        await refreshSession();
      }
    } catch {
      setUser(null);
      setCredentialsResolved(true);
      setStartupState('ERROR');
      setIsLoading(false);
    }
  };

  // Realtime subscription: sync user profile automatically when modified in Supabase
  useEffect(() => {
    if (!user?.email) return;
    const cleanEmail = user.email.toLowerCase().trim();
    const channelName = `user_profile_sync_${Date.now()}`;
    // Filter to only this user's email so other users' profile writes don't
    // trigger a rehydration (which would setUser with a new object and cascade
    // into a full vault resync).
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'users',
          filter: `email=eq.${cleanEmail}`,
        },
        async () => {
          try {
            const { data: dbUser } = await withTimeout(
              supabase
                .from('users')
                .select('*')
                .eq('email', cleanEmail)
                .maybeSingle(),
              10000,
              'user_profile_sync lookup'
            );
            if (dbUser) {
              await hydrateUserRecord(dbUser, masterPassword);
            }
          } catch {
            // ignore — transient network issue
          }
        }
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
  }, [user?.email, masterPassword]);

  const refreshUserProfile = async () => {
    if (!user?.email) return;

    try {
      const { data, error } = await withTimeout(
        supabase.functions.invoke(
          'user-profile-cache',
          { body: {} }
        ),
        15000,
        'refresh user-profile-cache'
      );
      if (!error && data?.dbUser) {
        await hydrateUserRecord(data.dbUser, masterPassword);
        return;
      }
    } catch {
      // fall through to direct Supabase read
    }

    try {
      const { data: dbUser } = await withTimeout(
        supabase
          .from('users')
          .select('*')
          .eq('email', user.email.toLowerCase().trim())
          .maybeSingle(),
        15000,
        'refresh users lookup'
      );
      if (dbUser) {
        await hydrateUserRecord(dbUser, masterPassword);
      }
    } catch {}
  };

  const check2FAStatus = async (email: string): Promise<{ requires2FA: boolean; secret?: string }> => {
    const cleanEmail = email.trim().toLowerCase();
    try {
      // 1. Query cloud database first for source of truth
      const { data } = await withTimeout(
        supabase
          .from('users')
          .select('*')
          .eq('email', cleanEmail)
          .maybeSingle(),
        15000,
        'check2FAStatus users lookup'
      );

      if (data) {
        const is2FA = !!(data.data?.twoFactorEnabled || data.two_factor_enabled);
        const sec = data.data?.twoFactorSecret || data.two_factor_secret;
        if (is2FA && sec) {
          await AsyncStorage.setItem(
            `clickrypt_2fa_config_${cleanEmail}`,
            JSON.stringify({ enabled: true, secret: sec })
          );
          return { requires2FA: true, secret: sec };
        } else if (data.data?.twoFactorEnabled === false || data.two_factor_enabled === false) {
          await AsyncStorage.setItem(
            `clickrypt_2fa_config_${cleanEmail}`,
            JSON.stringify({ enabled: false })
          );
          return { requires2FA: false };
        }
      }

      // 2. Check local persistent 2FA registry as fallback
      const local2FAStr = await AsyncStorage.getItem(`clickrypt_2fa_config_${cleanEmail}`);
      if (local2FAStr) {
        const parsed = JSON.parse(local2FAStr);
        if (parsed.enabled && parsed.secret) {
          return { requires2FA: true, secret: parsed.secret };
        } else if (parsed.enabled === false) {
          return { requires2FA: false };
        }
      }

      return { requires2FA: false };
    } catch {
      return { requires2FA: false };
    }
  };

  const verify2FACode = (secret: string, inputCode: string): boolean => {
    return verifyTOTPCode(secret, inputCode);
  };

  const toggleAccount2FA = async (enable: boolean, secret?: string): Promise<boolean> => {
    if (!user) return false;
    try {
      const cleanEmail = (user.email || '').toLowerCase().trim();
      const finalSecret = enable ? secret || user.twoFactorSecret : undefined;
      const updated: UserProfile = {
        ...user,
        twoFactorEnabled: enable,
        twoFactorSecret: finalSecret,
      };
      setUser(updated);
      await AsyncStorage.setItem('clickrypt_cached_user', JSON.stringify(updated));

      // Persist in device registry by email
      await AsyncStorage.setItem(
        `clickrypt_2fa_config_${cleanEmail}`,
        JSON.stringify({ enabled: enable, secret: finalSecret })
      );

      await withTimeout(
        supabase.from('users').upsert({
          id: user.id,
          email: cleanEmail,
          name: user.name,
          account_mode: appMode,
          data: {
            ...updated,
          },
        }),
        20000,
        'toggleAccount2FA upsert'
      );
      await withTimeout(
        supabase.functions.invoke('user-profile-cache-invalidate', { body: {} }),
        15000,
        'toggleAccount2FA invalidate cache'
      ).catch(() => {});
      return true;
    } catch {
      return false;
    }
  };

  const login = async (email: string, masterPass: string) => {
    const cleanEmail = email.trim().toLowerCase();
    try {
      setIsLoading(true);

      // 1. Attempt Supabase Auth Sign In
      let authUserId: string | undefined = undefined;
      try {
        const { data: authData, error: authError } = await withTimeout(
          supabase.auth.signInWithPassword({
            email: cleanEmail,
            password: masterPass,
          }),
          20000,
          'login signInWithPassword'
        );
        if (!authError && authData?.user) {
          authUserId = authData.user.id;
        }
      } catch {
        // Continue to verify with database profile
      }

      // 2. Query public.users table in Supabase to verify registered account
      const { data: dbUser } = await withTimeout(
        supabase
          .from('users')
          .select('*')
          .eq('email', cleanEmail)
          .maybeSingle(),
        15000,
        'login users lookup'
      );

      if (!dbUser) {
        // If user authenticated via Supabase Auth but profile row is missing in public.users, recreate it
        if (authUserId) {
          const { privateKey, publicKey } = await generateKeyPair(cleanEmail, masterPass);
          const recoveredUser: UserProfile = {
            id: `usr-${Date.now()}`,
            authId: authUserId,
            email: cleanEmail,
            name: cleanEmail.split('@')[0],
            role: 'Owner',
            accountMode: appMode,
            publicKey,
            encryptedPrivateKey: privateKey,
            twoFactorEnabled: false,
          };
          await withTimeout(
            supabase.from('users').upsert({
              id: recoveredUser.id,
              auth_id: authUserId,
              email: cleanEmail,
              name: recoveredUser.name,
              account_mode: appMode,
              data: recoveredUser,
            }),
            20000,
            'login recovered user upsert'
          );

          await withTimeout(
            supabase.functions.invoke('user-profile-cache-invalidate', { body: {} }),
            15000,
            'login invalidate cache'
          ).catch(() => {});

          let recoveredUnlocked = privateKey;
          try {
            recoveredUnlocked = await unprotectPrivateKey(privateKey, masterPass);
          } catch {
            // fall back to protected key
          }

          setUser(recoveredUser);
          setMasterPassword(masterPass);
          setUnlockedPgpKey(recoveredUnlocked);
          setCredentialsResolved(true);
          await AsyncStorage.setItem('clickrypt_cached_user', JSON.stringify(recoveredUser));
          await AsyncStorage.setItem('clickrypt_master_password', masterPass);
          await AsyncStorage.setItem('clickrypt_unlocked_pgp_key', recoveredUnlocked);
          await AsyncStorage.setItem('clickrypt_unlocked_key_source', privateKey);
          return { success: true };
        }

        // User does not exist in Auth or Database
        await withTimeout(
          supabase.auth.signOut(),
          10000,
          'login signOut'
        ).catch(() => {});
        await AsyncStorage.multiRemove([
          'clickrypt_cached_user',
          'clickrypt_master_password',
          'clickrypt_unlocked_pgp_key',
          'clickrypt_unlocked_key_source',
        ]);
        setCredentialsResolved(true);
        return {
          success: false,
          error: 'No account found with this email. Please register first or check your email/password.',
        };
      }

      const userObj = await hydrateUserRecord(dbUser, masterPass);
      if (userObj) {
        return { success: true };
      }
      return { success: false, error: 'Could not load user profile.' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Login failed' };
    } finally {
      setIsLoading(false);
    }
  };

  const unlockVault = async (passphrase: string): Promise<boolean> => {
    try {
      const cleanPass = passphrase ? passphrase.trim() : '';
      let keyToUnlock = user?.encryptedPrivateKey;
      const targetEmail =
        user?.email ||
        (await AsyncStorage.getItem('clickrypt_cached_user').then((s) => (s ? JSON.parse(s).email : null)));

      if (targetEmail) {
        try {
          const { data: dbUser } = await withTimeout(
            supabase
              .from('users')
              .select('*')
              .eq('email', targetEmail.toLowerCase().trim())
              .maybeSingle(),
            15000,
            'unlockVault users lookup'
          );
          if (dbUser?.data?.encryptedPrivateKey || dbUser?.encrypted_private_key) {
            keyToUnlock = dbUser.data?.encryptedPrivateKey || dbUser.encrypted_private_key;
          }
        } catch {}
      }

      if (!keyToUnlock) {
        const cachedUserStr = await AsyncStorage.getItem('clickrypt_cached_user');
        if (cachedUserStr) {
          try {
            const parsed = JSON.parse(cachedUserStr);
            keyToUnlock = parsed.encryptedPrivateKey;
          } catch {}
        }
      }

      if (!keyToUnlock) return false;

      const variants = [
        passphrase,
        cleanPass,
        passphrase ? passphrase.charAt(0).toLowerCase() + passphrase.slice(1) : '',
        cleanPass ? cleanPass.charAt(0).toLowerCase() + cleanPass.slice(1) : '',
        passphrase ? passphrase.charAt(0).toUpperCase() + passphrase.slice(1) : '',
        cleanPass ? cleanPass.charAt(0).toUpperCase() + cleanPass.slice(1) : '',
      ];
      const attempts = Array.from(new Set(variants)).filter(Boolean);
      for (const pass of attempts) {
        try {
          const unlocked = await unprotectPrivateKey(keyToUnlock, pass);
          if (unlocked) {
            setUnlockedPgpKey(unlocked);
            setMasterPassword(pass);
            await AsyncStorage.setItem('clickrypt_unlocked_pgp_key', unlocked);
            await AsyncStorage.setItem('clickrypt_master_password', pass);
            return true;
          }
        } catch {
          // continue
        }
      }
      return false;
    } catch {
      return false;
    }
  };

  const register = async (name: string, email: string, masterPass: string) => {
    const cleanEmail = email.trim().toLowerCase();
    try {
      setIsLoading(true);
      const { privateKey, publicKey } = await generateKeyPair(cleanEmail, masterPass);

      // Attempt Supabase Auth signup
      let authId: string | undefined = undefined;
      try {
        const { data: authData } = await withTimeout(
          supabase.auth.signUp({
            email: cleanEmail,
            password: masterPass,
            options: {
              data: { name, publicKey, encryptedPrivateKey: privateKey },
            },
          }),
          25000,
          'register signUp'
        );
        authId = authData?.user?.id;
      } catch {
        // Fall back to direct profile creation in public.users
      }

      const newUser: UserProfile = {
        id: `usr-${Date.now()}`,
        authId: authId || `auth-${Date.now()}`,
        email: cleanEmail,
        name: name.trim(),
        role: 'Owner',
        accountMode: appMode,
        publicKey,
        encryptedPrivateKey: privateKey,
        twoFactorEnabled: false,
      };

      // Unprotect the generated key once so vault decryption does not have to
      // re-run the expensive PGP KDF on every item later.
      let unlockedKey = privateKey;
      try {
        unlockedKey = await unprotectPrivateKey(privateKey, masterPass);
      } catch {
        // The generated key should always decrypt with the master passphrase,
        // but fall back to the protected key if something goes wrong.
        unlockedKey = privateKey;
      }

      setUser(newUser);
      setMasterPassword(masterPass);
      setUnlockedPgpKey(unlockedKey);
      setCredentialsResolved(true);
      await AsyncStorage.setItem('clickrypt_cached_user', JSON.stringify(newUser));
      await AsyncStorage.setItem('clickrypt_master_password', masterPass);
      await AsyncStorage.setItem('clickrypt_unlocked_pgp_key', unlockedKey);
      await AsyncStorage.setItem('clickrypt_unlocked_key_source', privateKey);

      // Save to Supabase 'users' table with full fallback compatibility
      const insertPayload: any = {
        id: newUser.id,
        auth_id: newUser.authId,
        email: cleanEmail,
        name: newUser.name,
        account_mode: appMode,
        data: {
          ...newUser,
          publicKey,
          encryptedPrivateKey: privateKey,
        },
      };

      await withTimeout(
        supabase.from('users').upsert(insertPayload),
        20000,
        'register users upsert'
      );

      await withTimeout(
        supabase.functions.invoke('user-profile-cache-invalidate', { body: {} }),
        15000,
        'register invalidate cache'
      ).catch(() => {});

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Registration failed' };
    } finally {
      setIsLoading(false);
    }
  };

  const unlockWithBiometrics = async (): Promise<boolean> => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!hasHardware) return false;
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock ClickRypt Vault',
        fallbackLabel: 'Use Master Password',
      });
      return result.success;
    } catch {
      return false;
    }
  };

  const updateProfile = async (
    newName: string,
    newEmail?: string,
    avatarUrl?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user || !newName.trim()) {
      return { success: false, error: 'Name is required' };
    }
    try {
      const cleanEmail = newEmail ? newEmail.trim().toLowerCase() : user.email;
      const finalAvatar = avatarUrl !== undefined ? avatarUrl : user.avatarUrl;
      const updatedUser: UserProfile = {
        ...user,
        name: newName.trim(),
        email: cleanEmail,
        avatarUrl: finalAvatar,
      };
      setUser(updatedUser);
      await AsyncStorage.setItem('clickrypt_cached_user', JSON.stringify(updatedUser));

      // Persist avatar and profile in persistent device registry by email
      if (finalAvatar) {
        await AsyncStorage.setItem(`clickrypt_avatar_${cleanEmail}`, finalAvatar);
      } else {
        await AsyncStorage.removeItem(`clickrypt_avatar_${cleanEmail}`);
      }
      await AsyncStorage.setItem(
        `clickrypt_profile_${cleanEmail}`,
        JSON.stringify({ name: newName.trim(), email: cleanEmail, avatarUrl: finalAvatar })
      );

      await withTimeout(
        supabase.from('users').upsert({
          id: user.id,
          email: cleanEmail,
          name: newName.trim(),
          avatar_url: finalAvatar,
          data: {
            ...updatedUser,
          },
        }),
        20000,
        'updateProfile users upsert'
      );
      await withTimeout(
        supabase.functions.invoke('user-profile-cache-invalidate', { body: {} }),
        15000,
        'updateProfile invalidate cache'
      ).catch(() => {});
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to update profile' };
    }
  };

  const switchModeAndLogout = async (targetMode: 'personal' | 'organization') => {
    await withTimeout(
      supabase.auth.signOut(),
      10000,
      'switchModeAndLogout signOut'
    ).catch(() => {});
    setUser(null);
    setMasterPassword(null);
    setUnlockedPgpKey(null);
    await AsyncStorage.multiRemove([
      'clickrypt_cached_user',
      'clickrypt_master_password',
      'clickrypt_unlocked_pgp_key',
      'clickrypt_unlocked_key_source',
    ]);
    await setAppMode(targetMode);
  };

  const logout = async () => {
    await withTimeout(
      supabase.auth.signOut(),
      10000,
      'logout signOut'
    ).catch(() => {});
    setUser(null);
    setMasterPassword(null);
    setUnlockedPgpKey(null);
    await AsyncStorage.multiRemove([
      'clickrypt_cached_user',
      'clickrypt_master_password',
      'clickrypt_unlocked_pgp_key',
      'clickrypt_unlocked_key_source',
    ]);
  };

  const deleteAccount = async (): Promise<{
    success: boolean;
    error?: string;
    failedStep?: string;
    failedTable?: string;
    warnings?: string[];
    legacyGroupsSkipped?: boolean;
  }> => {
    try {
      if (!user) return { success: false, error: 'No active session found.' };

      const userEmail = (user.email || '').toLowerCase().trim();
      const userId = user.id || '';

      // The actual deletion runs in a service-role edge function. The mobile
      // app cannot delete the Supabase Auth user with the anon key, and the
      // existing client-side deletes were silently failing due to RLS gaps
      // (owner_id only, not data->>ownerId) and not actually removing the
      // account from Supabase Auth.
      const { data, error } = await withTimeout(
        supabase.functions.invoke('delete-account', { body: {} }),
        30000,
        'delete-account'
      );

      if (error) {
        console.error('[Auth] delete-account edge function error', error);
        return {
          success: false,
          error:
            (error as any)?.message ||
            'Account deletion request failed. Please try again.',
        };
      }

      if (!data || !data.success) {
        const message = data?.error || 'Account deletion failed on the server.';
        console.error('[Auth] delete-account returned failure', data);
        return {
          success: false,
          error: message,
          failedStep: data?.failedStep,
          failedTable: data?.failedTable,
          warnings: data?.warnings,
          legacyGroupsSkipped: data?.legacyGroupsSkipped,
        };
      }

      // Only purge local state after the server confirmed the account is gone.
      const keysToPurge = [
        'clickrypt_cached_user',
        'clickrypt_cached_vault_personal',
        'clickrypt_cached_vault_organization',
        'clickrypt_master_password',
        'clickrypt_unlocked_pgp_key',
        'clickrypt_unlocked_key_source',
        `clickrypt_avatar_${userEmail}`,
        `clickrypt_profile_${userEmail}`,
        `clickrypt_2fa_config_${userEmail}`,
        `clickrypt_account_2fa_${userEmail}`,
        `clickrypt_activity_logs_${userEmail}`,
        `clickrypt_activity_logs_${userId}`,
        `clickrypt_activity_logs_unread_${userEmail}`,
      ];
      await AsyncStorage.multiRemove(keysToPurge);

      try {
        await supabase.auth.signOut();
      } catch {
        // ignore — auth user is already deleted, local session is irrelevant
      }

      // Reset in-memory auth state
      setUser(null);
      setMasterPassword(null);
      setUnlockedPgpKey(null);

      return {
        success: true,
        warnings: data?.warnings,
        legacyGroupsSkipped: data?.legacyGroupsSkipped,
      };
    } catch (err: any) {
      console.error('[Auth] deleteAccount exception', err);
      return { success: false, error: err?.message || 'Failed to delete account' };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        masterPassword,
        unlockedPgpKey,
        appMode,
        setAppMode,
        check2FAStatus,
        verify2FACode,
        toggleAccount2FA,
        login,
        register,
        unlockVault,
        unlockWithBiometrics,
        updateProfile,
        switchModeAndLogout,
        logout,
        deleteAccount,
        refreshUserProfile,
        isLoading,
        startupState,
        credentialsResolved,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
