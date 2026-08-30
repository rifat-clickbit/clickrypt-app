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
  TouchableOpacity,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { colors } from './src/theme/colors';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { VaultProvider, useVault } from './src/context/VaultContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { BottomNav, TabType } from './src/components/BottomNav';
import { PasswordsScreen } from './src/screens/PasswordsScreen';
import { CardsScreen } from './src/screens/CardsScreen';
import { FoldersScreen } from './src/screens/FoldersScreen';
import { TeamScreen } from './src/screens/TeamScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { NavPasswordsIcon } from './src/components/Icons';
import { initScreenProtection } from './src/services/screenProtection';
import { requestNotificationPermissions } from './src/services/notificationService';

const MainNavigator = () => {
  const { isAuthenticated, unlockWithBiometrics, appMode } = useAuth();
  const { activeTab, setActiveTab } = useVault();
  const { colors } = useTheme();
  const [isVaultLocked, setIsVaultLocked] = useState(false);
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
    }
  };

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
  const isWeb = Platform.OS === 'web';

  return (
    <View style={[styles.outerWebWrapper, { backgroundColor: isDark ? '#02090c' : '#f1f5f9' }]}>
      <SafeAreaView
        style={[
          styles.container,
          { backgroundColor: colors.bg },
          isWeb && styles.webContainer,
        ]}
        edges={['top', 'left', 'right']}
      >
        <ExpoStatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.bg} />
        <AuthProvider>
          <VaultProvider>
            <MainNavigator />
          </VaultProvider>
        </AuthProvider>
      </SafeAreaView>
    </View>
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
  outerWebWrapper: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  webContainer: {
    width: '100%',
    maxWidth: 480,
    height: '100%',
    maxHeight: '100%',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: 'rgba(34, 211, 238, 0.15)',
    borderRightColor: 'rgba(34, 211, 238, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 30,
  },
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
});
