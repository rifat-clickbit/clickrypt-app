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
  setSessionUnlockedKey,
  getSessionUnlockedKey,
  clearSessionKey,
  clearPrivateKeyCache,
  isVaultSessionUnlocked,
} from '../crypto/cryptoEngine';
import { withTimeout } from '../utils/withTimeout';
import { UserProfile, AppStartupState, AuthResult } from '../types';

interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isVaultUnlocked: boolean;
  appMode: 'personal' | 'organization';
  setAppMode: (mode: 'personal' | 'organization') => void;
  check2FAStatus: (email: string) => Promise<{ requires2FA: boolean; secret?: string }>;
  verify2FACode: (secret: string, code: string) => boolean;
  toggleAccount2FA: (enable: boolean, secret?: string) => Promise<AuthResult>;
  login: (email: string, masterPassword: string) => Promise<AuthResult>;
  register: (name: string, email: string, masterPassword: string) => Promise<AuthResult>;
  unlockVault: (password: string) => Promise<AuthResult>;
  lockVault: () => void;
  unlockWithBiometrics: () => Promise<AuthResult>;
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
  const [isVaultUnlocked, setIsVaultUnlocked] = useState<boolean>(isVaultSessionUnlocked());
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

      let parsedData: any = {};
      if (dbUser.data) {
        if (typeof dbUser.data === 'string') {
          try {
            parsedData = JSON.parse(dbUser.data);
          } catch {
            parsedData = {};
          }
        } else if (typeof dbUser.data === 'object') {
          parsedData = dbUser.data;
        }
      }

      const has2FA =
        parsedData.twoFactorEnabled !== undefined
          ? !!parsedData.twoFactorEnabled
          : dbUser.data?.twoFactorEnabled !== undefined
          ? !!dbUser.data?.twoFactorEnabled
          : dbUser.two_factor_enabled !== undefined
          ? !!dbUser.two_factor_enabled
          : is2FAActive;
      const sec = parsedData.twoFactorSecret || dbUser.data?.twoFactorSecret || dbUser.two_factor_secret || saved2FASecret;
      const resolvedAvatar =
        dbUser.avatar_url || parsedData.avatarUrl || dbUser.data?.avatarUrl || savedAvatar || undefined;
      const resolvedName =
        dbUser.name || parsedData.name || dbUser.data?.name || savedName || cleanEmail.split('@')[0];

      if (resolvedAvatar) {
        await AsyncStorage.setItem(`clickrypt_avatar_${cleanEmail}`, resolvedAvatar);
      }

      const rawEncKey =
        parsedData.encryptedPrivateKey ||
        parsedData.encrypted_private_key ||
        parsedData.privateKey ||
        parsedData.private_key ||
        dbUser.data?.encryptedPrivateKey ||
        dbUser.data?.encrypted_private_key ||
        dbUser.encrypted_private_key ||
        dbUser.private_key ||
        dbUser.data?.privateKey ||
        dbUser.encryptedPrivateKey;

      const userObj: UserProfile = {
        id: dbUser.id,
        authId: dbUser.auth_id,
        email: dbUser.email,
        name: resolvedName,
        role: parsedData.role || dbUser.data?.role || 'Owner',
        accountMode: dbUser.account_mode || 'personal',
        publicKey: parsedData.publicKey || dbUser.data?.publicKey || dbUser.public_key,
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
      let unlockedKey: string | null = getSessionUnlockedKey();

      if (providedPassword && rawEncKey) {
        const cleanPass = providedPassword.trim();
        try {
          const unlocked = await unprotectPrivateKey(rawEncKey, cleanPass);
          if (unlocked) {
            unlockedKey = unlocked;
            setSessionUnlockedKey(unlocked);
            setIsVaultUnlocked(true);
            console.log('[Auth] credentials decrypted', { success: true, timestamp: Date.now() });
          }
        } catch {
          if (cleanPass !== providedPassword) {
            try {
              const unlocked = await unprotectPrivateKey(rawEncKey, providedPassword);
              if (unlocked) {
                unlockedKey = unlocked;
                setSessionUnlockedKey(unlocked);
                setIsVaultUnlocked(true);
                console.log('[Auth] credentials decrypted', { success: true, timestamp: Date.now() });
              }
            } catch {
              console.log('[Auth] credentials decrypted', { success: false, timestamp: Date.now() });
            }
          } else {
            console.log('[Auth] credentials decrypted', { success: false, timestamp: Date.now() });
          }
        }
      } else {
        console.log('[Auth] credentials preserved from in-memory session', {
          hasKey: !!unlockedKey,
          timestamp: Date.now(),
        });
      }

      // Skip setUser if the profile data is unchanged.
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

      const [savedMode, cachedUserStr] = await Promise.all([
        AsyncStorage.getItem('clickrypt_app_mode'),
        AsyncStorage.getItem('clickrypt_cached_user'),
      ]);

      // Proactively purge any legacy plaintext keys or passwords from persistent storage
      AsyncStorage.multiRemove([
        'clickrypt_master_password',
        'clickrypt_unlocked_pgp_key',
        'clickrypt_unlocked_key_source',
      ]).catch(() => {});

      if (savedMode) setAppModeState(savedMode as 'personal' | 'organization');

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
            3000,
            'getSession'
          ).catch(() => ({ data: { session: null } } as any));

          if (sessionData?.session?.user) {
            const userEmail = (sessionData.session.user.email || '').toLowerCase().trim();

            let dbUser: any | null = null;
            try {
              const { data, error } = await withTimeout(
                supabase.functions.invoke('user-profile-cache', { body: {} }),
                5000,
                'user-profile-cache'
              );
              if (!error && data?.dbUser) {
                dbUser = data.dbUser;
              }
            } catch (err) {
              console.warn('[Auth] user-profile-cache notice:', err);
            }

            if (!dbUser) {
              try {
                const { data: directDbUser } = await withTimeout(
                  supabase
                    .from('users')
                    .select('*')
                    .eq('email', userEmail)
                    .maybeSingle(),
                  5000,
                  'loadSession users lookup'
                );
                dbUser = directDbUser;
              } catch (lookupErr) {
                console.warn('[Auth] direct user lookup notice:', lookupErr);
              }
            }

            if (dbUser) {
              setStartupState('DATABASE_READY');
              await hydrateUserRecord(dbUser);
              setStartupState('READY');
            } else {
              setStartupState('READY');
            }
          } else {
            setStartupState('READY');
          }
        } catch (err) {
          console.warn('[Auth] session refresh notice:', err);
          setStartupState('READY');
        } finally {
          setIsLoading(false);
          setCredentialsResolved(true);
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
              await hydrateUserRecord(dbUser);
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
  }, [user?.email]);

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
        await hydrateUserRecord(data.dbUser);
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
        await hydrateUserRecord(dbUser);
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
        3500,
        'check2FAStatus users lookup'
      ).catch(() => ({ data: null } as any));

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

  const toggleAccount2FA = async (enable: boolean, secret?: string): Promise<AuthResult> => {
    if (!user) return { success: false, code: 'USER_NOT_FOUND', error: 'No active session found.' };
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
      return { success: true };
    } catch (err: any) {
      return { success: false, code: 'NETWORK_ERROR', error: err?.message || 'Failed to update 2FA configuration' };
    }
  };

  const login = async (email: string, masterPass: string): Promise<AuthResult> => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPass = masterPass.trim();
    try {
      setIsLoading(true);

      // Run Supabase Auth sign-in and DB user lookup in parallel for fast login (<1.5s)
      const [authResult, dbResult] = await Promise.allSettled([
        withTimeout(
          supabase.auth.signInWithPassword({
            email: cleanEmail,
            password: masterPass,
          }),
          6000,
          'login signInWithPassword'
        ),
        withTimeout(
          supabase
            .from('users')
            .select('*')
            .eq('email', cleanEmail)
            .maybeSingle(),
          6000,
          'login users lookup'
        ),
      ]);

      let authUserId: string | undefined = undefined;
      if (authResult.status === 'fulfilled' && !authResult.value.error && authResult.value.data?.user) {
        authUserId = authResult.value.data.user.id;
      }

      let dbUser: any = null;
      if (dbResult.status === 'fulfilled' && dbResult.value?.data) {
        dbUser = dbResult.value.data;
      }

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
            8000,
            'login recovered user upsert'
          ).catch(() => {});

          let recoveredUnlocked: string | null = null;
          try {
            recoveredUnlocked = await unprotectPrivateKey(privateKey, cleanPass);
          } catch {
            try {
              recoveredUnlocked = await unprotectPrivateKey(privateKey, masterPass);
            } catch {}
          }

          if (recoveredUnlocked) {
            setSessionUnlockedKey(recoveredUnlocked);
            setIsVaultUnlocked(true);
          }

          setUser(recoveredUser);
          setCredentialsResolved(true);
          await AsyncStorage.setItem('clickrypt_cached_user', JSON.stringify(recoveredUser));
          return { success: true };
        }

        // User does not exist in Auth or Database
        await withTimeout(
          supabase.auth.signOut(),
          3000,
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
          code: 'USER_NOT_FOUND',
          error: 'No account found with this email. Please register first or check your email/password.',
        };
      }

      const userObj = await hydrateUserRecord(dbUser, masterPass);
      if (userObj) {
        const activeKey = getSessionUnlockedKey();
        if (!activeKey) {
          // If the provided master password failed to unlock the user's private key
          await supabase.auth.signOut().catch(() => {});
          setUser(null);
          clearSessionKey();
          setIsVaultUnlocked(false);
          return {
            success: false,
            code: 'INVALID_MASTER_PASSWORD',
            error: 'Incorrect Master Password. Please verify your password and try again.',
          };
        }
        return { success: true };
      }
      return { success: false, code: 'USER_NOT_FOUND', error: 'Could not load user profile.' };
    } catch (err: any) {
      return { success: false, code: 'UNKNOWN_ERROR', error: err?.message || 'Login failed' };
    } finally {
      setIsLoading(false);
    }
  };

  const unlockVault = async (passphrase: string): Promise<AuthResult> => {
    try {
      const cleanPass = passphrase ? passphrase.trim() : '';
      if (!cleanPass && !passphrase) {
        return {
          success: false,
          code: 'INVALID_MASTER_PASSWORD',
          error: 'Please enter your master password.',
        };
      }

      // 1. Fast local-first key lookup (0ms network latency)
      let rawData: any = {};
      if ((user as any)?.data) {
        if (typeof (user as any).data === 'string') {
          try { rawData = JSON.parse((user as any).data); } catch {}
        } else if (typeof (user as any).data === 'object') {
          rawData = (user as any).data;
        }
      }

      let keyToUnlock =
        user?.encryptedPrivateKey ||
        rawData?.encryptedPrivateKey ||
        rawData?.encrypted_private_key ||
        rawData?.privateKey ||
        rawData?.private_key ||
        (user as any)?.encrypted_private_key ||
        (user as any)?.private_key;

      if (!keyToUnlock) {
        const cachedUserStr = await AsyncStorage.getItem('clickrypt_cached_user');
        if (cachedUserStr) {
          try {
            const parsed = JSON.parse(cachedUserStr);
            let parsedInnerData: any = {};
            if (parsed.data) {
              if (typeof parsed.data === 'string') {
                try { parsedInnerData = JSON.parse(parsed.data); } catch {}
              } else if (typeof parsed.data === 'object') {
                parsedInnerData = parsed.data;
              }
            }
            keyToUnlock =
              parsed?.encryptedPrivateKey ||
              parsed?.encrypted_private_key ||
              parsed?.privateKey ||
              parsed?.private_key ||
              parsedInnerData?.encryptedPrivateKey ||
              parsedInnerData?.encrypted_private_key ||
              parsedInnerData?.privateKey ||
              parsedInnerData?.private_key;
          } catch {}
        }
      }

      // 2. Fallback to Supabase ONLY if local storage has no key
      if (!keyToUnlock) {
        const targetEmail =
          user?.email ||
          (await AsyncStorage.getItem('clickrypt_cached_user').then((s) => (s ? JSON.parse(s)?.email : null)));
        if (targetEmail) {
          try {
            const { data: dbUser } = await withTimeout(
              supabase
                .from('users')
                .select('*')
                .eq('email', targetEmail.toLowerCase().trim())
                .maybeSingle(),
              3000,
              'unlockVault fallback users lookup'
            );
            if (dbUser) {
              let fallbackData: any = {};
              if (dbUser.data) {
                if (typeof dbUser.data === 'string') {
                  try { fallbackData = JSON.parse(dbUser.data); } catch {}
                } else if (typeof dbUser.data === 'object') {
                  fallbackData = dbUser.data;
                }
              }
              keyToUnlock =
                fallbackData.encryptedPrivateKey ||
                fallbackData.encrypted_private_key ||
                fallbackData.privateKey ||
                fallbackData.private_key ||
                dbUser.encryptedPrivateKey ||
                dbUser.encrypted_private_key ||
                dbUser.private_key ||
                dbUser.privateKey;
            }
          } catch {}
        }
      }

      if (!keyToUnlock) {
        return {
          success: false,
          code: 'PRIVATE_KEY_MISSING',
          error: 'Encrypted private key not found on this device.',
        };
      }

      // 3. Fast single-pass OpenPGP decryption (~130ms) with automatic key normalization
      try {
        const unlocked = await unprotectPrivateKey(keyToUnlock, passphrase);
        if (unlocked) {
          setSessionUnlockedKey(unlocked);
          setIsVaultUnlocked(true);
          return { success: true };
        }
      } catch {
        if (cleanPass && cleanPass !== passphrase) {
          try {
            const unlocked = await unprotectPrivateKey(keyToUnlock, cleanPass);
            if (unlocked) {
              setSessionUnlockedKey(unlocked);
              setIsVaultUnlocked(true);
              return { success: true };
            }
          } catch {}
        }
      }

      return {
        success: false,
        code: 'INVALID_MASTER_PASSWORD',
        error: 'Incorrect Master Password. Please try again.',
      };
    } catch (err: any) {
      return {
        success: false,
        code: 'PRIVATE_KEY_DECRYPT_FAILED',
        error: err?.message || 'Failed to unlock vault.',
      };
    }
  };

  const lockVault = () => {
    clearSessionKey();
    clearPrivateKeyCache();
    setIsVaultUnlocked(false);
  };

  const register = async (name: string, email: string, masterPass: string): Promise<AuthResult> => {
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
        unlockedKey = await unprotectPrivateKey(privateKey, masterPass.trim());
      } catch {
        unlockedKey = privateKey;
      }

      setSessionUnlockedKey(unlockedKey);
      setIsVaultUnlocked(true);
      setUser(newUser);
      setCredentialsResolved(true);
      await AsyncStorage.setItem('clickrypt_cached_user', JSON.stringify(newUser));

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
      return { success: false, code: 'UNKNOWN_ERROR', error: err?.message || 'Registration failed' };
    } finally {
      setIsLoading(false);
    }
  };

  const unlockWithBiometrics = async (): Promise<AuthResult> => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!hasHardware) {
        return {
          success: false,
          code: 'BIOMETRICS_UNAVAILABLE',
          error: 'Biometric authentication is not supported on this device.',
        };
      }
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!isEnrolled) {
        return {
          success: false,
          code: 'BIOMETRICS_UNAVAILABLE',
          error: 'No biometrics enrolled on this device.',
        };
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock ClickRypt Vault',
        fallbackLabel: 'Use Master Password',
      });

      if (!result.success) {
        return {
          success: false,
          code: 'BIOMETRICS_CANCELLED',
          error: 'Biometric authentication was cancelled.',
        };
      }

      // Check if session key is already resident in memory
      if (isVaultSessionUnlocked()) {
        setIsVaultUnlocked(true);
        return { success: true };
      }

      return {
        success: false,
        code: 'UNLOCKED_KEY_MISSING',
        error: 'Vault session expired. Please enter your Master Password to unlock.',
      };
    } catch (err: any) {
      return {
        success: false,
        code: 'UNKNOWN_ERROR',
        error: err?.message || 'Biometric authentication failed.',
      };
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
    clearSessionKey();
    clearPrivateKeyCache();
    setIsVaultUnlocked(false);
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
    clearSessionKey();
    clearPrivateKeyCache();
    setIsVaultUnlocked(false);
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
        // ignore
      }

      setUser(null);
      clearSessionKey();
      clearPrivateKeyCache();
      setIsVaultUnlocked(false);

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
        isVaultUnlocked,
        appMode,
        setAppMode,
        check2FAStatus,
        verify2FACode,
        toggleAccount2FA,
        login,
        register,
        unlockVault,
        lockVault,
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
