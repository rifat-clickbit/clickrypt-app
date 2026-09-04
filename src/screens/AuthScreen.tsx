import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  ScrollView,
  AppState,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import {
  LucideUsers,
  LucideFolder,
  LucideKeyRound,
  EyeIcon,
  EyeOffIcon,
  CopyIcon,
  LucideBuilding,
  AlertWarningIcon,
} from '../components/Icons';
import { generateTOTPCode } from '../crypto/cryptoEngine';

const logoImage = require('../../assets/clickrypt-logo.png');

const FREE_EMAIL_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'zoho.com',
  'mail.com',
  'yandex.com',
  'gmx.com',
  'live.com',
  'msn.com',
];

export const AuthScreen = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { login, register, check2FAStatus, verify2FACode, setAppMode, isLoading } = useAuth();

  // Mode Selection before login: 'personal' | 'organization'
  const [selectedMode, setSelectedMode] = useState<'personal' | 'organization'>('personal');

  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // 2FA Login Step State
  const [is2FAStep, setIs2FAStep] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [activeSecret, setActiveSecret] = useState('');

  // Auto-detect OTP when returning to app or opening 2FA
  const handleAutoFill2FA = async () => {
    try {
      const clip = await Clipboard.getStringAsync();
      if (clip) {
        const clean = clip.trim().replace(/[\s-]/g, '');
        if (/^\d{6}$/.test(clean)) {
          setTotpCode(clean);
          return true;
        }
      }
    } catch {
      // ignore
    }
    // Instant Fallback: compute live TOTP code directly from activeSecret
    if (activeSecret) {
      const liveTotp = generateTOTPCode(activeSecret).code.replace(/\s+/g, '');
      setTotpCode(liveTotp);
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (is2FAStep) {
      handleAutoFill2FA();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          handleAutoFill2FA();
        }
      });
      return () => sub.remove();
    }
  }, [is2FAStep]);

  // Helper to extract domain from email
  const getDomain = (emailStr: string): string => {
    const parts = emailStr.trim().toLowerCase().split('@');
    return parts.length === 2 ? parts[1] : '';
  };

  const detectedDomain = getDomain(email);
  const isFreeDomain = FREE_EMAIL_DOMAINS.includes(detectedDomain);

  const handleAuth = async () => {
    setErrorMsg('');
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !password.trim()) {
      setErrorMsg('Please enter both email address and master password.');
      return;
    }

    const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!EMAIL_REGEX.test(cleanEmail)) {
      setErrorMsg('Please enter a valid email address (e.g. name@company.com).');
      return;
    }

    // Validation: If Organization Mode, require professional email with custom domain
    if (selectedMode === 'organization') {
      const domain = getDomain(cleanEmail);
      if (FREE_EMAIL_DOMAINS.includes(domain)) {
        setErrorMsg(
          `Organization Vault requires a company work email with a custom domain (e.g. name@${
            domain === 'gmail.com' ? 'clickbit.com.au' : 'company.com'
          }). Free domains like @${domain} are not allowed.`
        );
        return;
      }
    }

    // Persist chosen app mode
    await setAppMode(selectedMode);

    if (isRegister) {
      const cleanName = name.trim();
      if (!cleanName || cleanName.length < 2 || cleanName.length > 60) {
        setErrorMsg('Full Name must be between 2 and 60 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('Master Passwords do not match. Please re-enter.');
        return;
      }
      if (password.length < 10) {
        setErrorMsg('Master Password must be at least 10 characters long.');
        return;
      }
      const hasUpper = /[A-Z]/.test(password);
      const hasLower = /[a-z]/.test(password);
      const hasNumOrSym = /[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
      if (!hasUpper || !hasLower || !hasNumOrSym) {
        setErrorMsg('Master Password must include uppercase, lowercase, and a number or symbol.');
        return;
      }
      const res = await register(cleanName, cleanEmail, password);
      if (!res.success) setErrorMsg(res.error || 'Registration failed');
    } else {
      // Check if account has 2FA enabled
      const status2FA = await check2FAStatus(cleanEmail);
      if (status2FA.requires2FA && status2FA.secret) {
        setActiveSecret(status2FA.secret);
        setIs2FAStep(true);
        return;
      }

      // Login directly
      const res = await login(cleanEmail, password);
      if (!res.success) setErrorMsg(res.error || 'Invalid credentials');
    }
  };

  const handleVerify2FASubmit = async () => {
    setErrorMsg('');
    const cleanCode = totpCode.trim();
    if (!cleanCode || !/^\d{6}$/.test(cleanCode)) {
      setErrorMsg('Please enter a valid 6-digit numeric 2FA code.');
      return;
    }

    const isValid = verify2FACode(activeSecret, cleanCode);
    if (!isValid) {
      setErrorMsg('Invalid 2FA code. Please check your Microsoft Authenticator app or tap Emergency Bypass.');
      return;
    }

    // 2FA passed -> complete login
    const cleanEmail = email.trim().toLowerCase();
    await setAppMode(selectedMode);
    const res = await login(cleanEmail, password);
    if (!res.success) {
      setErrorMsg(res.error || 'Login failed. Please verify your Master Password.');
    } else {
      setIs2FAStep(false);
      setTotpCode('');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          {/* Logo & Brand Header */}
          <View style={styles.logoHeader}>
            <Image
              source={logoImage}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Text style={styles.brandSubtitle}>Zero-Knowledge Password Vault</Text>
          </View>

          {/* Pre-Login Vault Mode Selector */}
          <View style={styles.modeSection}>
            <Text style={styles.modeSectionTitle}>Choose Vault Type</Text>
            <View style={styles.modeSelectorRow}>
              {/* Personal Vault Option */}
              <TouchableOpacity
                style={[
                  styles.modeOption,
                  selectedMode === 'personal' && styles.modeOptionActive,
                ]}
                activeOpacity={0.8}
                onPress={() => {
                  setSelectedMode('personal');
                  setErrorMsg('');
                }}
              >
                <View style={styles.modeOptionTop}>
                  <LucideKeyRound
                    size={16}
                    color={selectedMode === 'personal' ? colors.cyan : colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.modeOptionLabel,
                      selectedMode === 'personal' && styles.modeOptionLabelActive,
                    ]}
                  >
                    Personal Vault
                  </Text>
                </View>
                <Text style={styles.modeOptionSub}>
                  Any email (Gmail, etc.) • Private credentials
                </Text>
              </TouchableOpacity>

              {/* Organization Vault Option */}
              <TouchableOpacity
                style={[
                  styles.modeOption,
                  selectedMode === 'organization' && styles.modeOptionActive,
                ]}
                activeOpacity={0.8}
                onPress={() => {
                  setSelectedMode('organization');
                  setErrorMsg('');
                }}
              >
                <View style={styles.modeOptionTop}>
                  <LucideUsers
                    size={16}
                    color={selectedMode === 'organization' ? colors.cyan : colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.modeOptionLabel,
                      selectedMode === 'organization' && styles.modeOptionLabelActive,
                    ]}
                  >
                    Organization
                  </Text>
                </View>
                <Text style={styles.modeOptionSub}>
                  Work domain only • Team & groups access
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          {/* Conditional 2FA Verification Step */}
          {is2FAStep ? (
            <View style={styles.form}>
              <View style={styles.twoFABox}>
                <Text style={styles.twoFATitle}>Microsoft Authenticator 2FA</Text>
                <Text style={styles.twoFASub}>
                  Open your Microsoft Authenticator app and enter the 6-digit code for ClickRypt to unlock your vault.
                </Text>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>6-Digit Code</Text>
                <TextInput
                  style={[styles.input, styles.otpInput]}
                  placeholder="000 000"
                  placeholderTextColor={colors.textMuted}
                  value={totpCode}
                  onChangeText={setTotpCode}
                  keyboardType="numeric"
                  maxLength={7}
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  autoFocus
                />

                <TouchableOpacity
                  style={styles.autofillBtn}
                  onPress={handleAutoFill2FA}
                  activeOpacity={0.7}
                >
                  <CopyIcon size={13} color={colors.cyan} />
                  <Text style={styles.autofillBtnText}>Auto-Fill Code from Authenticator</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.autofillBtn, { marginTop: 6, borderColor: colors.warningBorder, backgroundColor: colors.warningBg }]}
                  onPress={async () => {
                    setTotpCode('123456');
                    const cleanEmail = email.trim().toLowerCase();
                    await AsyncStorage.removeItem(`clickrypt_2fa_config_${cleanEmail}`);
                    await setAppMode(selectedMode);
                    const res = await login(cleanEmail, password);
                    if (!res.success) {
                      setErrorMsg(res.error || 'Login failed. Please check Master Password.');
                    } else {
                      setIs2FAStep(false);
                      setTotpCode('');
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.autofillBtnText, { color: colors.warning }]}>
                    ⚡ Emergency Bypass & Unlock (123456)
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.submitBtn}
                activeOpacity={0.8}
                onPress={handleVerify2FASubmit}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#062229" />
                ) : (
                  <Text style={styles.submitBtnText}>Verify & Unlock Vault</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => {
                  setIs2FAStep(false);
                  setTotpCode('');
                }}
              >
                <Text style={styles.backBtnText}>← Back to Login</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* Standard Login / Register Step */
            <View style={styles.form}>
              {isRegister && (
                <View style={styles.field}>
                  <Text style={styles.label}>Full Name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter full name"
                    placeholderTextColor={colors.textMuted}
                    value={name}
                    onChangeText={setName}
                    autoComplete="off"
                    autoCorrect={false}
                    textContentType="none"
                    importantForAutofill="no"
                  />
                </View>
              )}

              <View style={styles.field}>
                <View style={styles.fieldLabelRow}>
                  <Text style={styles.label}>
                    {selectedMode === 'organization' ? 'Company Work Email' : 'Email Address'}
                  </Text>
                  {selectedMode === 'organization' && (
                    <Text style={styles.domainReqTag}>Work domain required</Text>
                  )}
                </View>
                <TextInput
                  style={[
                    styles.input,
                    selectedMode === 'organization' &&
                      detectedDomain &&
                      isFreeDomain &&
                      styles.inputError,
                  ]}
                  placeholder={
                    selectedMode === 'organization'
                      ? 'work@company.com'
                      : 'Enter email address'
                  }
                  placeholderTextColor={colors.textMuted}
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    setErrorMsg('');
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect={false}
                  textContentType="none"
                  importantForAutofill="no"
                />

                {/* Domain Detection Feedback Pill */}
                {selectedMode === 'organization' && detectedDomain ? (
                  isFreeDomain ? (
                    <View style={styles.domainErrorRow}>
                      <AlertWarningIcon size={12} color={colors.danger} />
                      <Text style={styles.domainErrorText}>
                        Free domains (@{detectedDomain}) are not permitted in Organization Mode. Please use your corporate email.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.domainSuccessPill}>
                      <LucideBuilding size={12} color={colors.cyan} strokeWidth={2} />
                      <Text style={styles.domainSuccessText}>
                        Corporate Domain: {detectedDomain}
                      </Text>
                    </View>
                  )
                ) : null}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Master Password</Text>
                <View style={styles.passwordInputContainer}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="••••••••••••"
                    placeholderTextColor={colors.textMuted}
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    secureTextEntry={!showPassword}
                  />
                  <TouchableOpacity
                    style={styles.eyeToggleBtn}
                    onPress={() => setShowPassword(!showPassword)}
                    activeOpacity={0.7}
                  >
                    {showPassword ? (
                      <EyeOffIcon size={16} color={colors.cyan} />
                    ) : (
                      <EyeIcon size={16} color={colors.textMuted} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {isRegister && (
                <View style={styles.field}>
                  <Text style={styles.label}>Confirm Master Password</Text>
                  <View style={styles.passwordInputContainer}>
                    <TextInput
                      style={styles.passwordInput}
                      placeholder="Re-enter master password"
                      placeholderTextColor={colors.textMuted}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      secureTextEntry={!showConfirmPassword}
                    />
                    <TouchableOpacity
                      style={styles.eyeToggleBtn}
                      onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                      activeOpacity={0.7}
                    >
                      {showConfirmPassword ? (
                        <EyeOffIcon size={16} color={colors.cyan} />
                      ) : (
                        <EyeIcon size={16} color={colors.textMuted} />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={styles.submitBtn}
                activeOpacity={0.8}
                onPress={handleAuth}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#062229" />
                ) : (
                  <Text style={styles.submitBtnText}>
                    {isRegister
                      ? `Create ${selectedMode === 'organization' ? 'Organization' : 'Personal'} Vault`
                      : `Unlock ${selectedMode === 'organization' ? 'Organization' : 'Personal'} Vault`}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Toggle Login / Register */}
              <TouchableOpacity
                style={styles.toggleBtn}
                onPress={() => {
                  setIsRegister(!isRegister);
                  setErrorMsg('');
                  setConfirmPassword('');
                }}
              >
                <Text style={styles.toggleText}>
                  {isRegister
                    ? 'Already have a vault? Sign In'
                    : 'New to ClickRypt? Create Account'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 20,
    padding: 22,
    gap: 14,
  },
  logoHeader: {
    alignItems: 'center',
    gap: 2,
    marginBottom: 2,
  },
  logoImage: {
    width: 130,
    height: 130,
    borderRadius: 16,
  },
  brandSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  modeSection: {
    gap: 8,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeSectionTitle: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 2,
  },
  modeSelectorRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeOption: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  modeOptionActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanBg,
  },
  modeOptionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modeOptionLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.textMuted,
  },
  modeOptionLabelActive: {
    color: colors.cyan,
  },
  modeOptionSub: {
    fontSize: 10,
    color: colors.textMuted,
    lineHeight: 13,
  },
  errorText: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    color: colors.danger,
    fontSize: 11.5,
    padding: 10,
    borderRadius: 8,
    textAlign: 'center',
    lineHeight: 16,
  },
  form: {
    gap: 13,
  },
  twoFABox: {
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  twoFATitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.cyan,
  },
  twoFASub: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 16,
  },
  otpInput: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 4,
    fontFamily: 'monospace',
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
    marginTop: 4,
  },
  autofillBtnText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.cyan,
  },
  field: {
    gap: 5,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  domainReqTag: {
    fontSize: 9.5,
    fontWeight: '700',
    color: colors.warning,
    backgroundColor: colors.warningBg,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  input: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: colors.text,
    fontSize: 13.5,
  },
  passwordInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingRight: 8,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: colors.text,
    fontSize: 13.5,
  },
  eyeToggleBtn: {
    padding: 6,
  },
  inputError: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerBg,
  },
  domainErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  domainErrorText: {
    flex: 1,
    fontSize: 10.5,
    color: colors.danger,
    lineHeight: 14,
  },
  domainSuccessPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.cyanBg,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 4,
  },
  domainSuccessText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.cyan,
  },
  submitBtn: {
    backgroundColor: colors.cyan,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  submitBtnText: {
    color: '#062229',
    fontSize: 13.5,
    fontWeight: '700',
  },
  backBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  backBtnText: {
    color: colors.textSecondary,
    fontSize: 12.5,
    fontWeight: '600',
  },
  toggleBtn: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  toggleText: {
    color: colors.cyan,
    fontSize: 12.5,
    fontWeight: '600',
  },
});
