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
import { UserProfile } from '../types';

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
  deleteAccount: () => Promise<{ success: boolean; error?: string }>;
  refreshUserProfile: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [masterPassword, setMasterPassword] = useState<string | null>(null);
  const [unlockedPgpKey, setUnlockedPgpKey] = useState<string | null>(null);
  const [appMode, setAppModeState] = useState<'personal' | 'organization'>('personal');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSession();
  }, []);

  const setAppMode = async (mode: 'personal' | 'organization') => {
    setAppModeState(mode);
    await AsyncStorage.setItem('clickrypt_app_mode', mode);
  };

  const loadSession = async () => {
    try {
      setIsLoading(true);
      const savedMode = (await AsyncStorage.getItem('clickrypt_app_mode')) as 'personal' | 'organization';
      if (savedMode) setAppModeState(savedMode);

      const savedUnlocked = await AsyncStorage.getItem('clickrypt_unlocked_pgp_key');
      if (savedUnlocked) setUnlockedPgpKey(savedUnlocked);

      const savedPass = await AsyncStorage.getItem('clickrypt_master_password');
      if (savedPass) setMasterPassword(savedPass);

      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        const userEmail = (data.session.user.email || '').toLowerCase().trim();
        const { data: dbUser } = await supabase
          .from('users')
          .select('*')
          .eq('email', userEmail)
          .maybeSingle();

        if (dbUser) {
          await fetchUserProfile(data.session.user.id, userEmail);
        } else {
          // Account was deleted, invalidate session
          await supabase.auth.signOut();
          await AsyncStorage.removeItem('clickrypt_cached_user');
          setUser(null);
        }
      } else {
        const cachedUserStr = await AsyncStorage.getItem('clickrypt_cached_user');
        if (cachedUserStr) {
          try {
            const parsed = JSON.parse(cachedUserStr);
            if (parsed.email) {
              const cleanEmail = parsed.email.toLowerCase().trim();
              const { data: dbUser } = await supabase
                .from('users')
                .select('*')
                .eq('email', cleanEmail)
                .maybeSingle();
              if (dbUser) {
                // Always hydrate fresh profile from live database — never rely on stale cache
                await fetchUserProfile(dbUser.auth_id || undefined, cleanEmail);
              } else {
                await AsyncStorage.removeItem('clickrypt_cached_user');
                setUser(null);
              }
            } else {
              setUser(null);
            }
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Realtime subscription: sync user profile automatically when modified in Supabase
  useEffect(() => {
    if (!user?.email) return;
    const cleanEmail = user.email.toLowerCase().trim();
    const channelName = `user_profile_sync_${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'users',
        },
        (payload: any) => {
          const updatedEmail = (payload.new?.email || payload.old?.email || '').toLowerCase().trim();
          if (updatedEmail === cleanEmail) {
            fetchUserProfile(user.authId || undefined, cleanEmail);
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
    await fetchUserProfile(user.authId || undefined, user.email);
  };

  const fetchUserProfile = async (authId: string | undefined, email: string) => {
    const cleanEmail = email.trim().toLowerCase();
    try {
      let is2FAActive = false;
      let saved2FASecret: string | undefined = undefined;
      const local2FAStr = await AsyncStorage.getItem(`clickrypt_2fa_config_${cleanEmail}`);
      if (local2FAStr) {
        const parsed = JSON.parse(local2FAStr);
        if (parsed.enabled) {
          is2FAActive = true;
          saved2FASecret = parsed.secret;
        }
      }

      const savedAvatar = await AsyncStorage.getItem(`clickrypt_avatar_${cleanEmail}`);
      let savedName = cleanEmail.split('@')[0];
      const localProfileStr = await AsyncStorage.getItem(`clickrypt_profile_${cleanEmail}`);
      if (localProfileStr) {
        try {
          const parsedProf = JSON.parse(localProfileStr);
          if (parsedProf.name) savedName = parsedProf.name;
        } catch {
          // ignore
        }
      }

      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', cleanEmail)
        .maybeSingle();

      if (!error && data) {
        const has2FA =
          data.data?.twoFactorEnabled !== undefined
            ? !!data.data?.twoFactorEnabled
            : data.two_factor_enabled !== undefined
            ? !!data.two_factor_enabled
            : is2FAActive;
        const sec = data.data?.twoFactorSecret || data.two_factor_secret || saved2FASecret;
        const resolvedAvatar =
          data.avatar_url || data.data?.avatarUrl || savedAvatar || undefined;
        const resolvedName =
          data.name || data.data?.name || savedName || cleanEmail.split('@')[0];

        if (resolvedAvatar) {
          await AsyncStorage.setItem(`clickrypt_avatar_${cleanEmail}`, resolvedAvatar);
        }

        const userObj: UserProfile = {
          id: data.id,
          authId: data.auth_id,
          email: data.email,
          name: resolvedName,
          role: data.data?.role || 'Owner',
          accountMode: data.account_mode || 'personal',
          publicKey: data.data?.publicKey || data.public_key,
          encryptedPrivateKey: data.data?.encryptedPrivateKey || data.encrypted_private_key,
          avatarUrl: resolvedAvatar,
          twoFactorEnabled: has2FA,
          twoFactorSecret: sec,
        };
        setUser(userObj);
        await AsyncStorage.setItem('clickrypt_cached_user', JSON.stringify(userObj));

        // Auto pre-unlock PGP key if master password is saved
        const savedPass = await AsyncStorage.getItem('clickrypt_master_password');
        if (savedPass && userObj.encryptedPrivateKey) {
          try {
            const unlocked = await unprotectPrivateKey(userObj.encryptedPrivateKey, savedPass);
            if (unlocked) {
              setUnlockedPgpKey(unlocked);
              await AsyncStorage.setItem('clickrypt_unlocked_pgp_key', unlocked);
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  };

  const check2FAStatus = async (email: string): Promise<{ requires2FA: boolean; secret?: string }> => {
    const cleanEmail = email.trim().toLowerCase();
    try {
      // 1. Query cloud database first for source of truth
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('email', cleanEmail)
        .maybeSingle();

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

      await supabase.from('users').upsert({
        id: user.id,
        email: cleanEmail,
        name: user.name,
        account_mode: appMode,
        data: {
          ...updated,
        },
      });
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
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: masterPass,
        });
        if (!authError && authData?.user) {
          authUserId = authData.user.id;
        }
      } catch {
        // Continue to verify with database profile
      }

      // 2. Query public.users table in Supabase to verify registered account
      const { data: dbUser } = await supabase
        .from('users')
        .select('*')
        .eq('email', cleanEmail)
        .maybeSingle();

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
          await supabase.from('users').upsert({
            id: recoveredUser.id,
            auth_id: authUserId,
            email: cleanEmail,
            name: recoveredUser.name,
            account_mode: appMode,
            data: recoveredUser,
          });
          setUser(recoveredUser);
          setMasterPassword(masterPass);
          setUnlockedPgpKey(privateKey);
          await AsyncStorage.setItem('clickrypt_cached_user', JSON.stringify(recoveredUser));
          return { success: true };
        }

        // User does not exist in Auth or Database
        await supabase.auth.signOut();
        await AsyncStorage.multiRemove([
          'clickrypt_cached_user',
          'clickrypt_master_password',
          'clickrypt_unlocked_pgp_key',
        ]);
        return {
          success: false,
          error: 'No account found with this email. Please register first or check your email/password.',
        };
      }

      setMasterPassword(masterPass);
      await AsyncStorage.setItem('clickrypt_master_password', masterPass);

      const rawEncKey = dbUser.data?.encryptedPrivateKey || dbUser.encrypted_private_key;
      if (rawEncKey) {
        try {
          const unlocked = await unprotectPrivateKey(rawEncKey, masterPass);
          setUnlockedPgpKey(unlocked);
          await AsyncStorage.setItem('clickrypt_unlocked_pgp_key', unlocked);
        } catch {
          // ignore
        }
      }

      await fetchUserProfile(dbUser.auth_id || undefined, cleanEmail);
      return { success: true };
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
          const { data: dbUser } = await supabase
            .from('users')
            .select('*')
            .eq('email', targetEmail.toLowerCase().trim())
            .maybeSingle();
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
        const { data: authData } = await supabase.auth.signUp({
          email: cleanEmail,
          password: masterPass,
          options: {
            data: { name, publicKey, encryptedPrivateKey: privateKey },
          },
        });
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

      setUser(newUser);
      setMasterPassword(masterPass);
      setUnlockedPgpKey(privateKey);
      await AsyncStorage.setItem('clickrypt_cached_user', JSON.stringify(newUser));
      await AsyncStorage.setItem('clickrypt_master_password', masterPass);
      await AsyncStorage.setItem('clickrypt_unlocked_pgp_key', privateKey);

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

      await supabase.from('users').upsert(insertPayload);

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

      await supabase.from('users').upsert({
        id: user.id,
        email: cleanEmail,
        name: newName.trim(),
        avatar_url: finalAvatar,
        data: {
          ...updatedUser,
        },
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to update profile' };
    }
  };

  const switchModeAndLogout = async (targetMode: 'personal' | 'organization') => {
    await supabase.auth.signOut();
    setUser(null);
    setMasterPassword(null);
    setUnlockedPgpKey(null);
    await AsyncStorage.removeItem('clickrypt_cached_user');
    await setAppMode(targetMode);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setMasterPassword(null);
    setUnlockedPgpKey(null);
    await AsyncStorage.removeItem('clickrypt_cached_user');
  };

  const deleteAccount = async (): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!user) return { success: false, error: 'No active session found.' };

      const userEmail = (user.email || '').toLowerCase().trim();
      const userId = user.id || '';
      const authId = user.authId || '';

      // 1. Delete user's resources and shares from Supabase
      try {
        if (userId) {
          await supabase.from('resource_shares').delete().or(`shared_by.eq.${userId},recipient_id.eq.${userId}`);
          await supabase.from('resources').delete().eq('owner_id', userId);
          await supabase.from('folders').delete().eq('owner_id', userId);
          await supabase.from('group_members').delete().eq('user_id', userId);
          await supabase.from('activity_logs').delete().eq('user_id', userId);
        }
      } catch {
        // ignore
      }

      // 2. Delete user profile record from Supabase 'users' table
      try {
        if (userId) {
          await supabase.from('users').delete().eq('id', userId);
        }
        if (userEmail) {
          await supabase.from('users').delete().eq('email', userEmail);
        }
        if (authId) {
          await supabase.from('users').delete().eq('auth_id', authId);
        }
      } catch {
        // ignore
      }

      // 3. Remove from team_members if present
      try {
        if (userEmail) {
          await supabase.from('team_members').delete().eq('email', userEmail);
        }
      } catch {
        // ignore
      }

      // 4. Sign out from Supabase auth
      try {
        await supabase.auth.signOut();
      } catch {
        // ignore
      }

      // 5. Purge all local AsyncStorage keys thoroughly
      const keysToPurge = [
        'clickrypt_cached_user',
        'clickrypt_cached_vault_personal',
        'clickrypt_cached_vault_organization',
        'clickrypt_master_password',
        'clickrypt_unlocked_pgp_key',
        `clickrypt_avatar_${userEmail}`,
        `clickrypt_profile_${userEmail}`,
        `clickrypt_2fa_config_${userEmail}`,
        `clickrypt_account_2fa_${userEmail}`,
        `clickrypt_activity_logs_${userEmail}`,
        `clickrypt_activity_logs_${userId}`,
        `clickrypt_activity_logs_unread_${userEmail}`,
      ];
      await AsyncStorage.multiRemove(keysToPurge);

      // 6. Reset in-memory auth state
      setUser(null);
      setMasterPassword(null);
      setUnlockedPgpKey(null);

      return { success: true };
    } catch (err: any) {
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
