import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import {
  LucideUsers,
  LucideKeyRound,
  CheckIcon,
  LucideCamera,
  LucideTrash2,
  LucideBuilding,
  AlertWarningIcon,
} from './Icons';

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

interface EditProfileModalProps {
  visible: boolean;
  onClose: () => void;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({ visible, onClose }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, appMode, updateProfile } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (visible && user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setAvatarUri(user.avatarUrl || null);
      setSavedSuccess(false);
      setErrorMsg('');
    }
  }, [visible, user]);

  const initials = (name.trim() || email.split('@')[0] || 'RE')
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const getDomain = (emailStr: string): string => {
    const parts = emailStr.trim().toLowerCase().split('@');
    return parts.length === 2 ? parts[1] : '';
  };

  const detectedDomain = getDomain(email);
  const isFreeDomain = FREE_EMAIL_DOMAINS.includes(detectedDomain);

  const handlePickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please allow media library access to select a profile picture.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setAvatarUri(result.assets[0].uri);
      }
    } catch {
      Alert.alert('Error', 'Failed to open image picker.');
    }
  };

  const handleRemoveImage = () => {
    setAvatarUri(null);
  };

  const handleSave = async () => {
    setErrorMsg('');
    const cleanName = name.trim();

    if (!cleanName) {
      setErrorMsg('Please enter your full name.');
      return;
    }

    if (cleanName.length < 2 || cleanName.length > 60) {
      setErrorMsg('Full name must be between 2 and 60 characters.');
      return;
    }

    setIsSaving(true);
    const res = await updateProfile(cleanName, user?.email || email, avatarUri || undefined);
    setIsSaving(false);

    if (res.success) {
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 800);
    } else {
      setErrorMsg(res.error || 'Failed to update profile.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.content}>
          {/* Header */}
          <Text style={styles.title}>Edit Profile</Text>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
            {/* Avatar Section with Local Image Picker */}
            <View style={styles.avatarSection}>
              <TouchableOpacity
                style={styles.avatarCircle}
                activeOpacity={0.8}
                onPress={handlePickImage}
              >
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarText}>{initials}</Text>
                )}
                <View style={styles.cameraIconBadge}>
                  <LucideCamera size={13} color="#062229" />
                </View>
              </TouchableOpacity>

              <View style={styles.avatarBtnRow}>
                <TouchableOpacity
                  style={styles.photoActionBtn}
                  onPress={handlePickImage}
                  activeOpacity={0.7}
                >
                  <Text style={styles.photoActionText}>
                    {avatarUri ? 'Change Photo' : 'Upload Photo'}
                  </Text>
                </TouchableOpacity>

                {avatarUri && (
                  <TouchableOpacity
                    style={styles.photoRemoveBtn}
                    onPress={handleRemoveImage}
                    activeOpacity={0.7}
                  >
                    <LucideTrash2 size={12} color={colors.danger} />
                    <Text style={styles.photoRemoveText}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Mode Badge */}
              <View style={styles.badgeRow}>
                {appMode === 'organization' ? (
                  <View style={styles.orgBadge}>
                    <LucideUsers size={12} color={colors.cyan} />
                    <Text style={styles.orgBadgeText}>Organization Vault</Text>
                  </View>
                ) : (
                  <View style={styles.personalBadge}>
                    <LucideKeyRound size={12} color={colors.warning} />
                    <Text style={styles.personalBadgeText}>Personal Vault</Text>
                  </View>
                )}
              </View>
            </View>

            {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

            {/* Full Name Input */}
            <View style={styles.field}>
              <Text style={styles.label}>Full Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter full name"
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={(val) => {
                  setName(val);
                  setErrorMsg('');
                }}
                autoComplete="off"
                autoCorrect={false}
                textContentType="none"
                importantForAutofill="no"
              />
            </View>

            {/* Email Address Input (Read-only bound to cryptographic keys) */}
            <View style={styles.field}>
              <View style={styles.fieldLabelRow}>
                <Text style={styles.label}>
                  {appMode === 'organization' ? 'Company Work Email' : 'Email Address'}
                </Text>
                <View style={styles.lockedBadge}>
                  <LucideKeyRound size={11} color={colors.textMuted} />
                  <Text style={styles.lockedBadgeText}>Cryptographically Locked</Text>
                </View>
              </View>
              <TextInput
                style={[styles.input, styles.inputDisabled]}
                placeholder={
                  appMode === 'organization' ? 'work@company.com' : 'Enter email address'
                }
                placeholderTextColor={colors.textMuted}
                value={email}
                editable={false}
              />
              <Text style={styles.cryptoNoteText}>
                Your email address is cryptographically bound to your Zero-Knowledge OpenPGP key pair.
              </Text>
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.saveBtn, savedSuccess && styles.saveBtnSuccess]}
                activeOpacity={0.8}
                onPress={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color="#062229" size="small" />
                ) : savedSuccess ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <CheckIcon size={14} color="#062229" strokeWidth={2.5} />
                    <Text style={styles.saveText}>Saved</Text>
                  </View>
                ) : (
                  <Text style={styles.saveText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const createStyles = (colors: any) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlayBg,
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 30,
    },
  content: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 20,
    padding: 20,
    gap: 12,
    maxHeight: '90%',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  avatarSection: {
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.cyanBg,
    borderWidth: 2,
    borderColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 36,
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.cyan,
  },
  cameraIconBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: colors.cyan,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  photoActionBtn: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  photoActionText: {
    fontSize: 11,
    color: colors.cyan,
    fontWeight: '600',
  },
  photoRemoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  photoRemoveText: {
    fontSize: 11,
    color: colors.danger,
    fontWeight: '600',
  },
  badgeRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  orgBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.cyanBg,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
  },
  orgBadgeText: {
    fontSize: 11,
    color: colors.cyan,
    fontWeight: '600',
  },
  personalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
  },
  personalBadgeText: {
    fontSize: 11,
    color: colors.warning,
    fontWeight: '600',
  },
  errorText: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    color: colors.danger,
    fontSize: 11.5,
    padding: 8,
    borderRadius: 8,
    textAlign: 'center',
    lineHeight: 16,
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
    paddingVertical: 10,
    color: colors.text,
    fontSize: 13.5,
  },
  inputDisabled: {
    opacity: 0.7,
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    color: colors.textSecondary,
  },
  lockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lockedBadgeText: {
    fontSize: 9.5,
    color: colors.textMuted,
    fontWeight: '600',
  },
  cryptoNoteText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 15,
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: colors.cyan,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnSuccess: {
    backgroundColor: colors.success,
  },
  saveText: {
    color: '#062229',
    fontSize: 13,
    fontWeight: '700',
  },
});
