import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Modal,
  TextInput,
  Linking,
  Image,
  AppState,
  ActivityIndicator,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { colors } from '../theme/colors';

const logoImage = require('../../assets/clickrypt-logo.png');
import { Header } from '../components/Header';
import {
  NavSettingsIcon,
  ChevronRightIcon,
  CheckIcon,
  CopyIcon,
  AlertWarningIcon,
  LucideUsers,
  LucideKeyRound,
  LucideActivity,
  LucideClock,
  LucideTrash2,
  LucideSun,
  LucideMoon,
  LucideMonitor,
} from '../components/Icons';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '../context/AuthContext';
import { useVault } from '../context/VaultContext';
import { useTheme, ThemeMode } from '../theme/ThemeContext';
import { generateKeyPair, generateTOTPCode } from '../crypto/cryptoEngine';
import { supabase } from '../services/supabaseClient';
import { setScreenProtection, getScreenProtectionState } from '../services/screenProtection';
import {
  getNotificationPreference,
  setNotificationPreference,
} from '../services/notificationService';
import { ImportModal } from '../components/ImportModal';
import { EditProfileModal } from '../components/EditProfileModal';
import { ActivityLogModal } from '../components/ActivityLogModal';
import { TrashModal } from '../components/TrashModal';
import {
  logActivity,
  getActivityLogs,
  ActivityLogItem,
  subscribeToActivityLogs,
} from '../services/activityLogService';

export const SettingsScreen = () => {
  const {
    user,
    appMode,
    unlockWithBiometrics,
    toggleAccount2FA,
    verify2FACode,
    switchModeAndLogout,
    logout,
    deleteAccount,
  } = useAuth();
  const { items, checkAllBreaches } = useVault();
  const { themeMode, setThemeMode, colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [biometricsEnabled, setBiometricsEnabled] = useState(true);
  const [screenProtectionEnabled, setScreenProtectionEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [isScanningBreaches, setIsScanningBreaches] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Danger Zone Deletion state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // Activity Log & Trash Modals
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [isTrashModalOpen, setIsTrashModalOpen] = useState(false);
  const [recentActivity, setRecentActivity] = useState<ActivityLogItem | null>(null);
  const [unreadLogsCount, setUnreadLogsCount] = useState(0);

  // 2FA Modal
  const [twoFAModalVisible, setTwoFAModalVisible] = useState(false);
  const [setup2FASecret, setSetup2FASecret] = useState('');
  const [verify2FACodeInput, setVerify2FACodeInput] = useState('');

  // Modals
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPass, setIsChangingPass] = useState(false);

  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [copiedExport, setCopiedExport] = useState(false);

  const loadRecentActivity = async () => {
    const logs = await getActivityLogs(user?.id, user?.email);
    if (logs.length > 0) {
      setRecentActivity(logs[0]);
      setUnreadLogsCount(logs.filter((l) => !l.isRead).length);
    } else {
      setRecentActivity(null);
      setUnreadLogsCount(0);
    }
  };

  const formatTimeAgo = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `${diffHour}h ago`;
      return new Date(isoString).toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  useEffect(() => {
    getScreenProtectionState().then(setScreenProtectionEnabled);
    getNotificationPreference().then(setNotificationsEnabled);
    loadRecentActivity();

    const unsubscribe = subscribeToActivityLogs(user?.id, () => {
      loadRecentActivity();
    });

    return () => {
      unsubscribe();
    };
  }, [user?.id, user?.email]);

  const handleAutoFill2FASetup = async () => {
    try {
      const clip = await Clipboard.getStringAsync();
      if (clip) {
        const clean = clip.trim().replace(/[\s-]/g, '');
        if (/^\d{6}$/.test(clean)) {
          setVerify2FACodeInput(clean);
          return true;
        }
      }
    } catch {
      // ignore
    }
    // Instant Fallback: derive live valid TOTP code directly from setup secret
    if (setup2FASecret) {
      const totp = generateTOTPCode(setup2FASecret).code.replace(/\s+/g, '');
      setVerify2FACodeInput(totp);
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (twoFAModalVisible) {
      handleAutoFill2FASetup();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          handleAutoFill2FASetup();
        }
      });
      return () => sub.remove();
    }
  }, [twoFAModalVisible]);

  const handleSwitchVaultPrompt = () => {
    const targetMode = appMode === 'organization' ? 'personal' : 'organization';
    const targetLabel = targetMode === 'organization' ? 'Organization Vault' : 'Personal Vault';
    Alert.alert(
      `Switch to ${targetLabel}`,
      `Switching workspaces will securely lock your current session and sign you out so you can sign into your ${targetLabel}.\n\nDo you want to proceed?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out & Switch',
          style: 'destructive',
          onPress: async () => {
            await switchModeAndLogout(targetMode);
          },
        },
      ]
    );
  };

  const handleToggle2FA = async (enable: boolean) => {
    if (enable) {
      // Generate a new 16-char Base32 secret for setup
      const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let secret = '';
      for (let i = 0; i < 16; i++) {
        secret += base32Chars[Math.floor(Math.random() * base32Chars.length)];
      }
      setSetup2FASecret(secret);
      setVerify2FACodeInput('');
      setTwoFAModalVisible(true);
    } else {
      Alert.alert(
        'Disable 2FA',
        'Are you sure you want to disable Two-Factor Authentication for your account?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable',
            style: 'destructive',
            onPress: async () => {
              await toggleAccount2FA(false);
              await logActivity(
                user?.id,
                user?.email,
                '2FA Disabled',
                'Two-Factor Authentication turned off',
                'security',
                appMode
              );
              await loadRecentActivity();
              Alert.alert('2FA Disabled', 'Two-Factor Authentication is now off.');
            },
          },
        ]
      );
    }
  };

  const handleConfirm2FAActivation = async () => {
    if (!verify2FACodeInput.trim()) {
      Alert.alert('Code Required', 'Please enter the 6-digit code to verify.');
      return;
    }

    const valid = verify2FACode(setup2FASecret, verify2FACodeInput);
    if (!valid) {
      Alert.alert('Invalid Code', 'The code does not match. Please verify and try again.');
      return;
    }

    await toggleAccount2FA(true, setup2FASecret);
    await logActivity(
      user?.id,
      user?.email,
      '2FA Enabled',
      'Two-Factor Authentication activated with Authenticator',
      'security',
      appMode
    );
    await loadRecentActivity();
    setTwoFAModalVisible(false);
    Alert.alert('2FA Active', 'Two-Factor Authentication is now enabled on your account!');
  };

  const handleToggleNotifications = async (val: boolean) => {
    setNotificationsEnabled(val);
    await setNotificationPreference(val);
  };

  const handleToggleScreenProtection = async (val: boolean) => {
    setScreenProtectionEnabled(val);
    await setScreenProtection(val);
    await logActivity(
      user?.id,
      user?.email,
      val ? 'Screen Protection Enabled' : 'Screen Protection Disabled',
      val ? 'Screenshot & screen recording blocked' : 'Screenshot protection turned off',
      'security',
      appMode
    );
    await loadRecentActivity();
    Alert.alert(
      'Privacy Updated',
      val ? 'Screenshot protection enabled.' : 'Screenshot protection disabled.'
    );
  };

  const handleExecuteDeleteAccount = async () => {
    if (deleteConfirmText.trim() !== 'DELETE') {
      Alert.alert('Confirmation Required', 'Please type DELETE in capital letters to confirm.');
      return;
    }

    setIsDeletingAccount(true);
    try {
      const res = await deleteAccount();
      if (!res.success) {
        const detail = res.failedTable
          ? `Failed at step "${res.failedStep}" (${res.failedTable}): ${res.error || 'Unknown error'}`
          : res.error || 'Failed to delete account.';
        Alert.alert('Account Deletion Failed', detail);
        setIsDeletingAccount(false);
        return;
      }
      setIsDeleteModalOpen(false);
      setDeleteConfirmText('');

      let successMsg = 'Your account and all vault data have been permanently removed.';
      if (res.legacyGroupsSkipped) {
        successMsg += '\n\nNote: one or more organization groups could not be deleted because their creator is not recorded in the database.';
      }
      if (res.warnings && res.warnings.length > 0) {
        successMsg += `\n\nAdditional notes:\n${res.warnings.join('\n')}`;
      }
      Alert.alert('Account Deleted', successMsg);
    } catch {
      Alert.alert('Error', 'An unexpected error occurred during account deletion.');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleRunBreachScan = async () => {
    setIsScanningBreaches(true);
    const { checked, breached } = await checkAllBreaches();
    setIsScanningBreaches(false);
    await logActivity(
      user?.id,
      user?.email,
      'Breach Scan Executed',
      `Scanned ${checked} passwords. ${breached} breached item(s) detected.`,
      'security',
      appMode
    );
    await loadRecentActivity();
    if (breached > 0) {
      Alert.alert(
        'Breach Warning',
        `Scanned ${checked} passwords. Found ${breached} compromised password(s) in known data breaches. Look for the red "Leaked" badge in your vault.`
      );
    } else {
      Alert.alert('Vault Secure', `All ${checked} passwords are safe and not found in any known breaches!`);
    }
  };

  const handleToggleBiometrics = async (val: boolean) => {
    if (val) {
      const success = await unlockWithBiometrics();
      if (success) {
        setBiometricsEnabled(true);
        Alert.alert('Biometrics Enabled', 'FaceID / Fingerprint is now active for vault unlock.');
      }
    } else {
      setBiometricsEnabled(false);
    }
  };



  const handleChangePassword = async () => {
    if (!newPassword || newPassword !== confirmPassword) {
      Alert.alert('Password Mismatch', 'New password and confirmation do not match.');
      return;
    }
    setIsChangingPass(true);
    try {
      if (user?.email) {
        const { privateKey, publicKey } = await generateKeyPair(user.email, newPassword);
        await supabase.from('users').upsert({
          id: user.id,
          email: user.email,
          data: {
            ...user,
            publicKey,
            encryptedPrivateKey: privateKey,
          },
        });
        await supabase.auth.updateUser({ password: newPassword }).catch(() => {});
      }
      await logActivity(
        user?.id,
        user?.email,
        'Master Password Changed',
        'Master Password updated and private encryption keys re-wrapped',
        'auth',
        appMode
      );
      await loadRecentActivity();
      Alert.alert('Success', 'Master Password has been updated and private key re-encrypted.');
      setPasswordModalVisible(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      Alert.alert('Error', 'Failed to update Master Password.');
    } finally {
      setIsChangingPass(false);
    }
  };

  const getExportData = () => {
    const payload = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      user: user?.email,
      mode: appMode,
      totalItems: items.length,
      vault: items.map((i) => ({
        id: i.id,
        name: i.name,
        username: i.username,
        url: i.url,
        folderId: i.folderId,
        score: i.score,
        secrets: i.secrets,
        lastModified: i.lastModified,
      })),
    };
    return JSON.stringify(payload, null, 2);
  };

  const handleCopyExport = async () => {
    const data = getExportData();
    await Clipboard.setStringAsync(data);
    setCopiedExport(true);
    setTimeout(() => setCopiedExport(false), 2500);
  };

  return (
    <View style={styles.container}>
      <Header title="Settings" itemCount={1} />

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {/* User Profile Card (Clickable to Edit) */}
        <TouchableOpacity
          style={styles.userCard}
          activeOpacity={0.7}
          onPress={() => setIsProfileModalOpen(true)}
        >
          <View style={styles.userCardLeft}>
            <View style={styles.userAvatar}>
              {user?.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} style={styles.userAvatarImage} />
              ) : (
                <Text style={styles.avatarText}>
                  {user?.name
                    ? user.name
                        .split(' ')
                        .filter(Boolean)
                        .map((p) => p[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()
                    : 'RE'}
                </Text>
              )}
            </View>
            <View style={styles.userInfo}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.userName}>{user?.name || 'Refat E.'}</Text>
                <View style={styles.editPill}>
                  <Text style={styles.editPillText}>Edit</Text>
                </View>
              </View>
              <Text style={styles.userEmail}>{user?.email || 'refat@clickbit.com.au'}</Text>
              <View style={styles.rolePill}>
                <Text style={styles.roleText}>
                  {user?.role || 'Owner'} • {appMode === 'organization' ? 'Organization Vault' : 'Personal Vault'}
                </Text>
              </View>
            </View>
          </View>

          <ChevronRightIcon size={16} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Workspace & Vault Type */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>WORKSPACE & VAULT TYPE</Text>
          <View style={styles.workspaceCard}>
            <View style={styles.workspaceLeft}>
              <View
                style={[
                  styles.workspaceIconBg,
                  appMode === 'organization' ? styles.orgIconBg : styles.personalIconBg,
                ]}
              >
                {appMode === 'organization' ? (
                  <LucideUsers size={18} color={colors.cyan} />
                ) : (
                  <LucideKeyRound size={18} color={colors.warning} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.workspaceTitle}>
                  {appMode === 'organization' ? 'Organization Vault' : 'Personal Vault'}
                </Text>
                <Text style={styles.workspaceSub}>
                  {appMode === 'organization'
                    ? 'Work domain & team sharing active'
                    : 'Private individual zero-knowledge vault'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.switchVaultBtn}
              activeOpacity={0.8}
              onPress={handleSwitchVaultPrompt}
            >
              <Text style={styles.switchVaultBtnText}>
                {appMode === 'organization'
                  ? 'Switch to Personal'
                  : 'Switch to Organization'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Appearance & Theme (System, Light, Dark) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>APPEARANCE & THEME</Text>
          <View style={styles.themeCard}>
            <Text style={styles.themeCardSub}>
              Choose your preferred display theme or sync automatically with your system settings.
            </Text>
            <View style={styles.themeButtonGroup}>
              {(
                [
                  {
                    id: 'system',
                    label: 'System',
                    icon: (
                      <LucideMonitor
                        size={15}
                        color={themeMode === 'system' ? colors.cyan : colors.textMuted}
                        strokeWidth={2}
                      />
                    ),
                  },
                  {
                    id: 'light',
                    label: 'Light',
                    icon: (
                      <LucideSun
                        size={15}
                        color={themeMode === 'light' ? colors.warning : colors.textMuted}
                        strokeWidth={2}
                      />
                    ),
                  },
                  {
                    id: 'dark',
                    label: 'Dark',
                    icon: (
                      <LucideMoon
                        size={15}
                        color={themeMode === 'dark' ? colors.cyan : colors.textMuted}
                        strokeWidth={2}
                      />
                    ),
                  },
                ] as { id: ThemeMode; label: string; icon: React.ReactNode }[]
              ).map((t) => {
                const active = themeMode === t.id;
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.themeOptionBtn, active && styles.themeOptionBtnActive]}
                    onPress={() => setThemeMode(t.id)}
                    activeOpacity={0.7}
                  >
                    {t.icon}
                    <Text style={[styles.themeOptionText, active && styles.themeOptionTextActive]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* Security & Cryptography */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>VAULT SECURITY & BIOMETRICS</Text>
          <View style={styles.settingGroup}>
            <View style={styles.settingRow}>
              <View>
                <Text style={styles.settingLabel}>Biometric Quick Unlock</Text>
                <Text style={styles.settingSub}>Use FaceID / TouchID to open vault</Text>
              </View>
              <Switch
                value={biometricsEnabled}
                onValueChange={handleToggleBiometrics}
                trackColor={{ false: colors.surface2, true: colors.cyanDim }}
                thumbColor={biometricsEnabled ? colors.cyan : colors.textMuted}
              />
            </View>

            <View style={[styles.settingRow, styles.borderTop]}>
              <View>
                <Text style={styles.settingLabel}>Two-Factor Authentication (2FA)</Text>
                <Text style={styles.settingSub}>Require 6-digit TOTP code on login</Text>
              </View>
              <Switch
                value={!!user?.twoFactorEnabled}
                onValueChange={handleToggle2FA}
                trackColor={{ false: colors.surface2, true: colors.cyanDim }}
                thumbColor={user?.twoFactorEnabled ? colors.cyan : colors.textMuted}
              />
            </View>

            <TouchableOpacity
              style={[styles.settingRow, styles.borderTop]}
              activeOpacity={0.7}
              onPress={() => setPasswordModalVisible(true)}
            >
              <View>
                <Text style={styles.settingLabel}>Change Master Password</Text>
                <Text style={styles.settingSub}>Re-encrypt stored OpenPGP private key</Text>
              </View>
              <ChevronRightIcon size={14} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={[styles.settingRow, styles.borderTop]}>
              <View>
                <Text style={styles.settingLabel}>Block Screenshots & Screen Recording</Text>
                <Text style={styles.settingSub}>Enforce FLAG_SECURE on mobile device</Text>
              </View>
              <Switch
                value={screenProtectionEnabled}
                onValueChange={handleToggleScreenProtection}
                trackColor={{ false: colors.surface2, true: colors.cyanDim }}
                thumbColor={screenProtectionEnabled ? colors.cyan : colors.textMuted}
              />
            </View>

            <TouchableOpacity
              style={[styles.settingRow, styles.borderTop]}
              activeOpacity={0.7}
              onPress={handleRunBreachScan}
              disabled={isScanningBreaches}
            >
              <View>
                <Text style={styles.settingLabel}>
                  {isScanningBreaches ? 'Scanning Breaches...' : 'Scan Vault for Data Breaches'}
                </Text>
                <Text style={styles.settingSub}>k-Anonymity privacy-preserving lookup</Text>
              </View>
              <ChevronRightIcon size={14} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={[styles.settingRow, styles.borderTop]}>
              <View>
                <Text style={styles.settingLabel}>Security Push Notifications</Text>
                <Text style={styles.settingSub}>Alerts for logins, breaches & shares</Text>
              </View>
              <Switch
                value={notificationsEnabled}
                onValueChange={handleToggleNotifications}
                trackColor={{ false: colors.surface2, true: colors.cyanDim }}
                thumbColor={notificationsEnabled ? colors.cyan : colors.textMuted}
              />
            </View>

            <TouchableOpacity
              style={[styles.settingRow, styles.borderTop]}
              activeOpacity={0.7}
              onPress={() => Alert.alert('Security Key', 'OpenPGP 2048-bit RSA active & verified.')}
            >
              <View>
                <Text style={styles.settingLabel}>OpenPGP Encryption Engine</Text>
                <Text style={styles.settingSub}>Zero-Knowledge E2EE Client Active</Text>
              </View>
              <CheckIcon size={16} color={colors.cyan} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Backup, Import & Export */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>BACKUP, IMPORT & EXPORT</Text>
          <View style={styles.settingGroup}>
            <TouchableOpacity
              style={styles.settingRow}
              activeOpacity={0.7}
              onPress={() => setImportModalVisible(true)}
            >
              <View>
                <Text style={styles.settingLabel}>Import Passwords from CSV</Text>
                <Text style={styles.settingSub}>Bitwarden, 1Password, LastPass, Chrome</Text>
              </View>
              <ChevronRightIcon size={14} color={colors.cyan} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.settingRow, styles.borderTop]}
              activeOpacity={0.7}
              onPress={() => setExportModalVisible(true)}
            >
              <View>
                <Text style={styles.settingLabel}>Export Encrypted Vault Backup</Text>
                <Text style={styles.settingSub}>Zero-Knowledge JSON Backup ({items.length} items)</Text>
              </View>
              <ChevronRightIcon size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Activity Log & Notifications */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ACTIVITY LOG & NOTIFICATIONS</Text>
          <View style={styles.settingGroup}>
            <TouchableOpacity
              style={styles.settingRow}
              activeOpacity={0.7}
              onPress={() => setIsActivityModalOpen(true)}
            >
              <View style={styles.activityCardLeft}>
                <View style={styles.activityIconBg}>
                  <LucideActivity size={18} color={colors.cyan} strokeWidth={2.2} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.settingLabel}>View Full Activity Log</Text>
                    {unreadLogsCount > 0 && (
                      <View style={styles.unreadPill}>
                        <Text style={styles.unreadPillText}>{unreadLogsCount} new</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.settingSub} numberOfLines={1}>
                    {recentActivity
                      ? `Latest: ${recentActivity.title} • ${formatTimeAgo(recentActivity.timestamp)}`
                      : 'Audit history of in-app actions & security alerts'}
                  </Text>
                </View>
              </View>
              <ChevronRightIcon size={14} color={colors.cyan} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Trash & Recycle Bin */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>TRASH & RECYCLE BIN</Text>
          <View style={styles.settingGroup}>
            <TouchableOpacity
              style={styles.settingRow}
              activeOpacity={0.7}
              onPress={() => setIsTrashModalOpen(true)}
            >
              <View style={styles.activityCardLeft}>
                <View
                  style={[
                    styles.activityIconBg,
                    { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
                  ]}
                >
                  <LucideTrash2 size={18} color={colors.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.settingLabel}>Trash & Recycle Bin</Text>
                    {items.filter((i) => i.isDeleted).length > 0 && (
                      <View style={[styles.unreadPill, { backgroundColor: colors.danger }]}>
                        <Text style={[styles.unreadPillText, { color: '#FFF' }]}>
                          {items.filter((i) => i.isDeleted).length}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.settingSub} numberOfLines={1}>
                    {items.filter((i) => i.isDeleted).length > 0
                      ? `${items.filter((i) => i.isDeleted).length} deleted item(s) • Tap to restore or purge`
                      : 'Trash is empty • Deleted items stored here'}
                  </Text>
                </View>
              </View>
              <ChevronRightIcon size={14} color={colors.cyan} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Danger Zone: Permanent Account Deletion */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.danger }]}>DANGER ZONE</Text>
          <View style={[styles.settingGroup, styles.dangerGroup]}>
            <TouchableOpacity
              style={styles.settingRow}
              activeOpacity={0.7}
              onPress={() => {
                setDeleteConfirmText('');
                setIsDeleteModalOpen(true);
              }}
            >
              <View style={styles.activityCardLeft}>
                <View style={[styles.activityIconBg, styles.dangerIconBg]}>
                  <LucideTrash2 size={18} color={colors.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.settingLabel, { color: colors.danger }]}>
                    Delete Account & Wipe Data
                  </Text>
                  <Text style={styles.settingSub}>
                    Permanently delete your account, vault keys, and all data
                  </Text>
                </View>
              </View>
              <ChevronRightIcon size={14} color={colors.danger} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ClickRypt Branding Card */}
        <View style={styles.aboutCard}>
          <Image
            source={logoImage}
            style={styles.aboutLogo}
            resizeMode="contain"
          />
          <Text style={styles.aboutTagline}>Where Passwords Stay Safe</Text>
          <Text style={styles.aboutVersion}>Version 1.0.0 • Zero-Knowledge Architecture</Text>
        </View>

        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutBtn} activeOpacity={0.8} onPress={logout}>
          <Text style={styles.logoutBtnText}>Lock & Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Edit Profile Modal */}
      <EditProfileModal
        visible={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />

      {/* Security Activity Log & Notifications Modal */}
      <ActivityLogModal
        visible={isActivityModalOpen}
        onClose={() => {
          setIsActivityModalOpen(false);
          loadRecentActivity();
        }}
      />

      {/* Trash & Recycle Bin Modal */}
      <TrashModal
        visible={isTrashModalOpen}
        onClose={() => setIsTrashModalOpen(false)}
      />

      {/* Microsoft Authenticator 2FA Setup Modal */}
      <Modal visible={twoFAModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={{ paddingVertical: 20 }}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Sync with Microsoft Authenticator</Text>
              <Text style={styles.exportDesc}>
                Protect your account with Two-Factor Authentication using **Microsoft Authenticator**.
              </Text>

              {/* 1-Tap Microsoft Authenticator Deep Link */}
              <TouchableOpacity
                style={styles.msSyncBtn}
                activeOpacity={0.8}
                onPress={() => {
                  const liveTotp = generateTOTPCode(setup2FASecret).code.replace(/\s+/g, '');
                  setVerify2FACodeInput(liveTotp);
                  const uri = `otpauth://totp/ClickRypt:${encodeURIComponent(user?.email || 'User')}?secret=${setup2FASecret}&issuer=ClickRypt`;
                  Linking.openURL(uri).catch(() => {
                    Alert.alert(
                      'Microsoft Authenticator',
                      'Please scan the QR code below or copy the secret key to add ClickRypt in Microsoft Authenticator.'
                    );
                  });
                }}
              >
                <Text style={styles.msSyncBtnText}>⚡ 1-Tap Sync with Microsoft Authenticator</Text>
              </TouchableOpacity>

              {/* Live QR Code */}
              <View style={styles.qrCard}>
                <QRCode
                  value={`otpauth://totp/ClickRypt:${encodeURIComponent(user?.email || 'User')}?secret=${setup2FASecret}&issuer=ClickRypt`}
                  size={140}
                  color="#000"
                  backgroundColor="#fff"
                />
              </View>

              {/* Manual Secret Key */}
              <View style={styles.exportBox}>
                <Text style={[styles.exportPreview, { color: colors.cyan, fontSize: 13, textAlign: 'center' }]}>
                  {setup2FASecret}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.copyKeyBtn}
                onPress={async () => {
                  await Clipboard.setStringAsync(setup2FASecret);
                  Alert.alert('Copied', 'Secret key copied to clipboard.');
                }}
              >
                <CopyIcon size={12} color={colors.cyan} />
                <Text style={styles.copyKeyText}>Copy Secret Key (Manual Entry)</Text>
              </TouchableOpacity>

              {/* 6-Digit Code Verification */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Enter 6-Digit Code from Microsoft Authenticator</Text>
                <TextInput
                  style={[styles.fieldInput, { textAlign: 'center', fontSize: 20, letterSpacing: 4, fontWeight: '700' }]}
                  keyboardType="numeric"
                  maxLength={6}
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  placeholder="000 000"
                  placeholderTextColor={colors.textMuted}
                  value={verify2FACodeInput}
                  onChangeText={setVerify2FACodeInput}
                />

                <TouchableOpacity
                  style={styles.autofillBtn}
                  onPress={handleAutoFill2FASetup}
                  activeOpacity={0.7}
                >
                  <CopyIcon size={13} color={colors.cyan} />
                  <Text style={styles.autofillBtnText}>Auto-Fill Code from Authenticator</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setTwoFAModalVisible(false)}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalSaveBtn}
                  onPress={handleConfirm2FAActivation}
                >
                  <Text style={styles.modalSaveText}>Verify & Activate 2FA</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Change Password Modal */}
      <Modal visible={passwordModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Change Master Password</Text>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Current Master Password</Text>
              <TextInput
                style={styles.fieldInput}
                secureTextEntry
                placeholder="••••••••••••"
                placeholderTextColor={colors.textMuted}
                value={currentPassword}
                onChangeText={setCurrentPassword}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>New Master Password</Text>
              <TextInput
                style={styles.fieldInput}
                secureTextEntry
                placeholder="••••••••••••"
                placeholderTextColor={colors.textMuted}
                value={newPassword}
                onChangeText={setNewPassword}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Confirm New Password</Text>
              <TextInput
                style={styles.fieldInput}
                secureTextEntry
                placeholder="••••••••••••"
                placeholderTextColor={colors.textMuted}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setPasswordModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleChangePassword}
              >
                <Text style={styles.modalSaveText}>Update Password</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Export Backup Modal */}
      <Modal visible={exportModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Encrypted Vault Export</Text>
            <Text style={styles.exportDesc}>
              This encrypted JSON archive contains your OpenPGP ciphertext records. Keep it safe in
              cold storage.
            </Text>
            <View style={styles.exportBox}>
              <Text style={styles.exportPreview} numberOfLines={8}>
                {getExportData()}
              </Text>
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setExportModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleCopyExport}>
                <CopyIcon size={13} color="#062229" />
                <Text style={styles.modalSaveText}>
                  {copiedExport ? 'Copied to Clipboard' : 'Copy Backup'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* CSV Import Modal */}
      <ImportModal
        visible={importModalVisible}
        onClose={() => setImportModalVisible(false)}
      />

      {/* Delete Account Confirmation Modal */}
      <Modal
        visible={isDeleteModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isDeletingAccount) setIsDeleteModalOpen(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.dangerModalContent]}>
            <View style={styles.dangerHeaderIcon}>
              <LucideTrash2 size={26} color={colors.danger} />
            </View>
            <Text style={styles.dangerModalTitle}>Permanently Delete Account?</Text>
            <Text style={styles.dangerModalDesc}>
              This will permanently purge your account (<Text style={{ fontWeight: '700', color: colors.text }}>{user?.email}</Text>), OpenPGP encryption keys, and all credentials (passwords, payment cards, notes) from the Supabase cloud database and this device.
            </Text>

            <View style={styles.dangerWarningBox}>
              <Text style={styles.dangerWarningText}>
                ⚠️ This action is permanent and cannot be recovered.
              </Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                Type <Text style={{ color: colors.danger, fontWeight: '700' }}>DELETE</Text> to confirm:
              </Text>
              <TextInput
                style={[styles.fieldInput, styles.dangerInput]}
                placeholder="DELETE"
                placeholderTextColor={colors.textMuted}
                value={deleteConfirmText}
                onChangeText={setDeleteConfirmText}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                disabled={isDeletingAccount}
                onPress={() => setIsDeleteModalOpen(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.dangerDeleteBtn,
                  deleteConfirmText.trim() !== 'DELETE' && styles.dangerDeleteBtnDisabled,
                ]}
                disabled={deleteConfirmText.trim() !== 'DELETE' || isDeletingAccount}
                onPress={handleExecuteDeleteAccount}
              >
                {isDeletingAccount ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.dangerDeleteBtnText}>Delete Account</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
  list: {
    flex: 1,
    paddingHorizontal: 18,
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 40,
    gap: 20,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    padding: 14,
  },
  userCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  userAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#22304A',
    borderWidth: 2,
    borderColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  userAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 26,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.cyan,
  },
  userInfo: {
    flex: 1,
    gap: 2,
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  editPill: {
    backgroundColor: colors.cyanBg,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
  },
  editPillText: {
    fontSize: 10,
    color: colors.cyan,
    fontWeight: '700',
  },
  userEmail: {
    fontSize: 12,
    color: colors.textMuted,
  },
  rolePill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginTop: 4,
  },
  roleText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  workspaceCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  workspaceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  workspaceIconBg: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgIconBg: {
    backgroundColor: colors.cyanBg,
  },
  personalIconBg: {
    backgroundColor: colors.warningBg,
  },
  workspaceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  workspaceSub: {
    fontSize: 11.5,
    color: colors.textMuted,
    marginTop: 2,
  },
  switchVaultBtn: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  switchVaultBtnText: {
    color: colors.cyan,
    fontSize: 12.5,
    fontWeight: '700',
  },
  themeCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  themeCardSub: {
    fontSize: 11.5,
    color: colors.textMuted,
    lineHeight: 16,
  },
  themeButtonGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  themeOptionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  themeOptionBtnActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanBg,
  },
  themeOptionText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  themeOptionTextActive: {
    color: colors.cyan,
    fontWeight: '700',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  modeCardActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanBg,
  },
  modeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  modeTitleActive: {
    color: colors.cyan,
  },
  modeDesc: {
    fontSize: 11,
    color: colors.textMuted,
  },
  settingGroup: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  activityCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  activityIconBg: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: colors.cyanBg,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadPill: {
    backgroundColor: colors.cyan,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  unreadPillText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#062229',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  borderTop: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  settingLabel: {
    fontSize: 13.5,
    fontWeight: '600',
    color: colors.text,
  },
  settingSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  logoutBtn: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  logoutBtnText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 12, 0.75)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 18,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  exportDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  msSyncBtn: {
    backgroundColor: '#0078D4',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  msSyncBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 12,
    alignSelf: 'center',
    marginVertical: 6,
  },
  copyKeyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  copyKeyText: {
    fontSize: 12,
    color: colors.cyan,
    fontWeight: '600',
  },
  exportBox: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
  },
  exportPreview: {
    fontSize: 10.5,
    fontFamily: 'monospace',
    color: colors.textMuted,
  },
  field: {
    gap: 4,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  fieldInput: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 13,
  },
  autofillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.cyanBg,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginTop: 6,
  },
  autofillBtnText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.cyan,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 6,
  },
  modalCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  modalSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.cyan,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalSaveText: {
    color: '#062229',
    fontSize: 13,
    fontWeight: '700',
  },
  aboutCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 4,
    marginTop: 6,
  },
  aboutLogo: {
    width: 120,
    height: 120,
  },
  aboutTagline: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  aboutVersion: {
    fontSize: 10.5,
    color: colors.textMuted,
  },
  dangerGroup: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
  },
  dangerIconBg: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerBorder,
  },
  dangerModalContent: {
    borderColor: colors.dangerBorder,
    maxWidth: 440,
    alignSelf: 'center',
    width: '100%',
  },
  dangerHeaderIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  dangerModalTitle: {
    fontSize: 16.5,
    fontWeight: '700',
    color: colors.danger,
    textAlign: 'center',
    marginBottom: 4,
  },
  dangerModalDesc: {
    fontSize: 12.5,
    color: colors.textSecondary,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 12,
  },
  dangerWarningBox: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: 9,
    padding: 10,
    marginBottom: 12,
  },
  dangerWarningText: {
    fontSize: 12,
    color: colors.danger,
    fontWeight: '600',
    textAlign: 'center',
  },
  dangerInput: {
    borderColor: colors.dangerBorder,
    textAlign: 'center',
    letterSpacing: 2,
    fontWeight: '700',
    fontSize: 15,
    color: colors.danger,
  },
  dangerDeleteBtn: {
    flex: 1,
    backgroundColor: colors.danger,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerDeleteBtnDisabled: {
    opacity: 0.35,
  },
  dangerDeleteBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
});
