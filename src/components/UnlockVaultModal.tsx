import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { LucideKeyRound, EyeIcon, EyeOffIcon, CloseIcon } from './Icons';

interface UnlockVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (password: string) => Promise<boolean>;
  title?: string;
  description?: string;
}

export const UnlockVaultModal: React.FC<UnlockVaultModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  title = 'Unlock Vault',
  description = 'Enter your master password to decrypt and view credentials.',
}) => {
  const { colors } = useTheme();
  const { user, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!password) {
      setError('Please enter your master password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const ok = await onSubmit(password);
      if (ok) {
        setPassword('');
        onClose();
      } else {
        setError('Incorrect master password. Please verify and try again.');
      }
    } catch {
      setError('Could not unlock the vault. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setPassword('');
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              {/* Header */}
              <View style={styles.headerRow}>
                <View style={styles.titleGroup}>
                  <View style={[styles.iconBox, { backgroundColor: colors.cyanBg }]}>
                    <LucideKeyRound size={20} color={colors.cyan} strokeWidth={2} />
                  </View>
                  <View style={styles.textGroup}>
                    <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
                    <Text style={[styles.subtitle, { color: colors.textMuted }]}>{description}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                  <CloseIcon size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Password Input */}
              <View style={styles.inputContainer}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary, marginBottom: 0 }]}>Master Password</Text>
                  {user?.email ? (
                    <Text style={{ fontSize: 11, color: colors.textMuted }}>
                      for <Text style={{ color: colors.cyan, fontWeight: '600' }}>{user.email}</Text>
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.inputWrapper, { backgroundColor: colors.bg, borderColor: error ? colors.danger : colors.border }]}>
                  <TextInput
                    style={[styles.input, { color: colors.text }]}
                    placeholder="Enter master password"
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={(val) => {
                      setPassword(val);
                      if (error) setError(null);
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    autoFocus
                    onSubmitEditing={handleSubmit}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword((prev) => !prev)}
                    style={styles.eyeBtn}
                  >
                    {showPassword ? (
                      <EyeOffIcon size={18} color={colors.textMuted} />
                    ) : (
                      <EyeIcon size={18} color={colors.textMuted} />
                    )}
                  </TouchableOpacity>
                </View>
                {error ? (
                  <View style={{ marginTop: 6 }}>
                    <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
                    <TouchableOpacity
                      onPress={async () => {
                        handleClose();
                        await logout();
                      }}
                      style={{ marginTop: 6, alignSelf: 'flex-start' }}
                    >
                      <Text style={{ fontSize: 12, color: colors.cyan, textDecorationLine: 'underline' }}>
                        Need to log in again to sync keys? Tap here
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>

              {/* Actions */}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.cancelBtn, { borderColor: colors.border }]}
                  onPress={handleClose}
                  disabled={loading}
                >
                  <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.submitBtn, { backgroundColor: colors.cyan }]}
                  onPress={handleSubmit}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#0F172A" />
                  ) : (
                    <Text style={styles.submitBtnText}>Unlock</Text>
                  )}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textGroup: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 3,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  closeBtn: {
    padding: 4,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    height: '100%',
  },
  eyeBtn: {
    padding: 6,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  submitBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
});
