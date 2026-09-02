import './src/crypto/cryptoPolyfill';
import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  StatusBar,
  Platform,
  AppState,
  AppStateStatus,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { colors } from './src/theme/colors';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { useVault } from './src/context/VaultContext';
import { VaultProvider } from './src/context/VaultContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { BottomNav, TabType } from './src/components/BottomNav';
import { PasswordsScreen } from './src/screens/PasswordsScreen';
import { CardsScreen } from './src/screens/CardsScreen';
import { FoldersScreen } from './src/screens/FoldersScreen';
import { TeamScreen } from './src/screens/TeamScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { NavPasswordsIcon } from './src/components/Icons';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { initScreenProtection } from './src/services/screenProtection';
import { requestNotificationPermissions } from './src/services/notificationService';

const MainNavigator = () => {
  const { isAuthenticated, isLoading, unlockWithBiometrics, unlockVault, appMode } = useAuth();
  const { activeTab, setActiveTab } = useVault();
  const { colors } = useTheme();
  const [isVaultLocked, setIsVaultLocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const backgroundTimeRef = useRef<number | null>(null);

  // If switched to personal mode while on team tab, switch to passwords
  useEffect(() => {
    if (appMode === 'personal' && activeTab === 'team') {
      setActiveTab('passwords');
    }
  }, [appMode, activeTab]);

  useEffect(() => {
    initScreenProtection();
    requestNotificationPermissions();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        backgroundTimeRef.current = Date.now();
      } else if (nextAppState === 'active') {
        if (backgroundTimeRef.current) {
          const elapsed = (Date.now() - backgroundTimeRef.current) / 1000;
          // Auto-lock after 120 seconds in background
          if (elapsed > 120) {
            setIsVaultLocked(true);
          }
        }
        backgroundTimeRef.current = null;
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const handleUnlock = async () => {
    const success = await unlockWithBiometrics();
    if (success) {
      setIsVaultLocked(false);
      setUnlockError(null);
      setPasswordInput('');
    }
  };

  const handlePasswordUnlock = async () => {
    if (!passwordInput.trim()) return;
    setIsUnlocking(true);
    setUnlockError(null);
    try {
      const ok = await unlockVault(passwordInput);
      if (ok) {
        setIsVaultLocked(false);
        setPasswordInput('');
        setUnlockError(null);
      } else {
        setUnlockError('Incorrect master password.');
      }
    } catch {
      setUnlockError('Unlock failed. Please try again.');
    } finally {
      setIsUnlocking(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.screenWrapper, { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.cyan} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  if (isVaultLocked) {
    return (
      <View style={[styles.lockOverlay, { backgroundColor: colors.bg }]}>
        <View style={[styles.lockCard, { backgroundColor: colors.surface, borderColor: colors.borderStrong }]}>
          <View style={[styles.lockBadge, { backgroundColor: colors.cyanBg, borderColor: colors.cyanBorder }]}>
            <NavPasswordsIcon size={32} color={colors.cyan} />
          </View>
          <Text style={[styles.lockTitle, { color: colors.text }]}>ClickRypt Locked</Text>
          <Text style={[styles.lockSubtitle, { color: colors.textMuted }]}>
            Vault locked automatically due to inactivity.
          </Text>
          <TouchableOpacity style={[styles.unlockBtn, { backgroundColor: colors.cyan }]} activeOpacity={0.8} onPress={handleUnlock}>
            <Text style={styles.unlockBtnText}>Unlock with Biometrics</Text>
          </TouchableOpacity>

          {/* Master-password fallback so the app is never permanently trapped
              when biometrics fail or are unavailable. */}
          <View style={styles.lockDivider}>
            <View style={[styles.lockDividerLine, { backgroundColor: colors.borderStrong }]} />
            <Text style={[styles.lockDividerText, { color: colors.textMuted }]}>or</Text>
            <View style={[styles.lockDividerLine, { backgroundColor: colors.borderStrong }]} />
          </View>

          <TextInput
            style={[
              styles.lockInput,
              {
                backgroundColor: colors.bg,
                borderColor: unlockError ? colors.danger : colors.borderStrong,
                color: colors.text,
              },
            ]}
            placeholder="Master password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={passwordInput}
            onChangeText={(text) => {
              setPasswordInput(text);
              if (unlockError) setUnlockError(null);
            }}
            onSubmitEditing={handlePasswordUnlock}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {!!unlockError && (
            <Text style={[styles.lockErrorText, { color: colors.danger }]}>{unlockError}</Text>
          )}

          <TouchableOpacity
            style={[
              styles.unlockBtn,
              { backgroundColor: colors.cyan, opacity: isUnlocking || !passwordInput.trim() ? 0.5 : 1 },
            ]}
            activeOpacity={0.8}
            onPress={handlePasswordUnlock}
            disabled={isUnlocking || !passwordInput.trim()}
          >
            {isUnlocking ? (
              <ActivityIndicator size="small" color="#062229" />
            ) : (
              <Text style={styles.unlockBtnText}>Unlock with Password</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screenWrapper, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        {activeTab === 'passwords' && <PasswordsScreen />}
        {activeTab === 'cards' && <CardsScreen />}
        {activeTab === 'folders' && <FoldersScreen />}
        {activeTab === 'team' && <TeamScreen />}
        {activeTab === 'settings' && <SettingsScreen />}
      </View>
      <BottomNav currentTab={activeTab} onTabChange={setActiveTab} appMode={appMode} />
    </View>
  );
};

const AppRoot = () => {
  const { colors, isDark } = useTheme();

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: colors.bg },
      ]}
      edges={['top', 'left', 'right']}
    >
      <ExpoStatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.bg} />
        <AuthProvider>
          <VaultProvider>
            <ErrorBoundary>
              <MainNavigator />
            </ErrorBoundary>
          </VaultProvider>
        </AuthProvider>
      </SafeAreaView>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppRoot />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.bg,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  screenWrapper: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
  },
  lockOverlay: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  lockCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 12,
    width: '100%',
    maxWidth: 320,
  },
  lockBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.cyanBg,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  lockTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  lockSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
  unlockBtn: {
    backgroundColor: colors.cyan,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 8,
    width: '100%',
  },
  unlockBtnText: {
    color: '#062229',
    fontSize: 13.5,
    fontWeight: '700',
  },
  lockDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: 4,
  },
  lockDividerLine: {
    flex: 1,
    height: 1,
  },
  lockDividerText: {
    fontSize: 11,
    marginHorizontal: 8,
  },
  lockInput: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  lockErrorText: {
    fontSize: 12,
    fontWeight: '600',
    width: '100%',
    textAlign: 'center',
  },
});
