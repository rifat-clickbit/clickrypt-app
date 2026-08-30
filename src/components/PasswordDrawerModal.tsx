import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  Switch,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { colors } from '../theme/colors';
import {
  generatePassword,
  generatePassphrase,
  evaluatePasswordStrength,
} from '../crypto/cryptoEngine';
import { VaultItem } from '../types';
import { useVault } from '../context/VaultContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import {
  SyncIcon,
  LucideFileText,
  NavPasswordsIcon,
  NavCardsIcon,
  LucideFolder,
  LucideSparkles,
  LucideRotateCcw,
  EyeIcon,
  EyeOffIcon,
} from './Icons';

interface PasswordDrawerModalProps {
  visible: boolean;
  onClose: () => void;
  editItem?: VaultItem | null;
  defaultFolderId?: string;
  isSecretVault?: boolean;
  initialType?: 'login' | 'card' | 'note';
}

type EntryType = 'login' | 'card' | 'note';

function isValidUrl(val: string): boolean {
  if (!val || !val.trim()) return false;
  const trimmed = val.trim().toLowerCase();
  const urlPattern = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/i;
  const localhostPattern = /^(https?:\/\/)?localhost(:\d+)?(\/.*)?$/i;
  const ipPattern = /^(https?:\/\/)?(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/i;
  return urlPattern.test(trimmed) || localhostPattern.test(trimmed) || ipPattern.test(trimmed);
}

export const PasswordDrawerModal: React.FC<PasswordDrawerModalProps> = ({
  visible,
  onClose,
  editItem,
  defaultFolderId,
  isSecretVault = false,
  initialType,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { createItem, updateItem, folders } = useVault();
  const { appMode } = useAuth();

  const [entryType, setEntryType] = useState<EntryType>('login');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [password, setPassword] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');

  // Password Generator state
  const [showPassword, setShowPassword] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [passLength, setPassLength] = useState(16);
  const [incUppercase, setIncUppercase] = useState(true);
  const [incNumbers, setIncNumbers] = useState(true);
  const [incSymbols, setIncSymbols] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setUrlError('');
    if (editItem) {
      const detectedType: EntryType =
        editItem.itemType || (editItem.isPrivateOnly ? 'card' : 'login');
      setEntryType(detectedType);
      setName(editItem.name || '');
      setUsername(editItem.username || '');
      setUrl(editItem.url || '');
      setPassword(editItem.decryptedPassword || '');
      setShowPassword(false);
      setNoteContent(editItem.noteContent || editItem.decryptedPassword || '');
      setSelectedFolderId(editItem.folderId || '');
    } else {
      if (initialType) {
        setEntryType(initialType);
      } else if (isSecretVault) {
        setEntryType('card');
      } else {
        setEntryType('login');
      }
      setName('');
      setUsername('');
      setUrl('');
      
      // Auto-generate strong 16-character password by default for new passwords
      const initialPass = generatePassword({
        length: 16,
        useUppercase: true,
        useNumbers: true,
        useSymbols: true,
      });
      setPassword(initialPass);
      setShowPassword(true);
      setNoteContent('');
      setSelectedFolderId(defaultFolderId || folders[0]?.id || '');
      setCardNumber('');
      setExpiry('');
      setCvv('');
    }
  }, [editItem, defaultFolderId, visible, isSecretVault, initialType]);

  const handleGenerate = (
    lengthOverride?: number,
    upperOverride?: boolean,
    numOverride?: boolean,
    symOverride?: boolean
  ) => {
    const len = lengthOverride ?? passLength;
    const upper = upperOverride ?? incUppercase;
    const num = numOverride ?? incNumbers;
    const sym = symOverride ?? incSymbols;
    const generated = generatePassword({
      length: len,
      useUppercase: upper,
      useNumbers: num,
      useSymbols: sym,
    });
    setPassword(generated);
    return generated;
  };

  const strength = evaluatePasswordStrength(password);

  const handleSubmit = async () => {
    if (!name.trim()) return;

    // Validate Website URL for login passwords
    if (entryType === 'login') {
      if (!url.trim()) {
        setUrlError('Website URL is required.');
        return;
      }
      if (!isValidUrl(url)) {
        setUrlError('Please enter a valid website URL (e.g. github.com or https://example.com)');
        return;
      }
    }

    setLoading(true);

    let secretValue = password;
    if (entryType === 'card') {
      secretValue = JSON.stringify({
        type: 'card',
        holder: name.trim(),
        cardNumber: cardNumber.replace(/\s+/g, ''),
        expiry: expiry.trim(),
        cvv: cvv.trim(),
      });
    } else if (entryType === 'note') {
      secretValue = noteContent;
    }

    if (editItem) {
      const updatesPayload: any = {
        name,
        username: entryType === 'card' ? name.trim() : username,
        url: entryType === 'card' ? 'payment-card' : entryType === 'note' ? 'secure-note' : url.trim(),
        folderId: selectedFolderId || null,
        noteContent: entryType === 'note' ? noteContent : undefined,
        itemType: entryType,
      };
      if (secretValue && secretValue.trim()) {
        updatesPayload.password = secretValue;
      }
      await updateItem(editItem.id, updatesPayload);
    } else {
      await createItem({
        name,
        username: entryType === 'card' ? name.trim() : username,
        url: entryType === 'card' ? 'payment-card' : entryType === 'note' ? 'secure-note' : url.trim(),
        password: secretValue,
        noteContent: entryType === 'note' ? noteContent : undefined,
        folderId: selectedFolderId || null,
        isPrivateOnly: entryType === 'card',
        itemType: entryType,
      });
    }

    setLoading(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {editItem
                ? entryType === 'note'
                  ? 'Edit Secure Note'
                  : entryType === 'card'
                  ? 'Edit Payment Card'
                  : 'Edit Password'
                : appMode === 'personal'
                ? isSecretVault || entryType === 'card'
                  ? 'New Payment Card'
                  : 'New Password'
                : entryType === 'note'
                ? 'New Secure Note'
                : entryType === 'card'
                ? 'New Payment Card'
                : 'New Password Item'}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {/* Item Type Switcher (only for Organization Vault new items) */}
          {!editItem && appMode === 'organization' && (
            <View style={styles.typeSelector}>
              {(
                [
                  { id: 'login', label: 'Login', icon: <NavPasswordsIcon size={14} color={entryType === 'login' ? colors.cyan : colors.textMuted} /> },
                  { id: 'card', label: 'Payment Card', icon: <NavCardsIcon size={14} color={entryType === 'card' ? colors.cyan : colors.textMuted} /> },
                  { id: 'note', label: 'Secure Note', icon: <LucideFileText size={14} color={entryType === 'note' ? colors.cyan : colors.textMuted} /> },
                ] as { id: EntryType; label: string; icon: React.ReactNode }[]
              ).map((tab) => {
                const active = entryType === tab.id;
                return (
                  <TouchableOpacity
                    key={tab.id}
                    style={[styles.typePill, active && styles.typePillActive]}
                    onPress={() => setEntryType(tab.id)}
                    activeOpacity={0.7}
                  >
                    {tab.icon}
                    <Text style={[styles.typePillText, active && styles.typePillTextActive]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <ScrollView style={styles.formBody} contentContainerStyle={styles.formContent}>
            {/* Title / Name */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>
                {entryType === 'card'
                  ? 'Cardholder Name'
                  : entryType === 'note'
                  ? 'Note Title'
                  : 'Item Title'}
              </Text>
              <TextInput
                style={styles.input}
                placeholder={
                  entryType === 'card'
                    ? 'Cardholder name'
                    : entryType === 'note'
                    ? 'Note title'
                    : 'Title'
                }
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
                autoComplete="off"
                autoCorrect={false}
                textContentType="none"
                importantForAutofill="no"
              />
            </View>

            {/* SECURE NOTE BODY */}
            {entryType === 'note' && (
              <View style={styles.fieldGroup}>
                <View style={styles.noteHeaderRow}>
                  <Text style={styles.label}>Secret Note Content</Text>
                  <Text style={styles.noteCount}>
                    {noteContent.length} chars • {noteContent.split(/\s+/).filter(Boolean).length} words
                  </Text>
                </View>
                <TextInput
                  style={styles.noteTextArea}
                  placeholder="Type or paste confidential notes, backup codes, server SSH keys, or private text..."
                  placeholderTextColor={colors.textMuted}
                  value={noteContent}
                  onChangeText={setNoteContent}
                  multiline
                  numberOfLines={8}
                  textAlignVertical="top"
                  autoComplete="off"
                  autoCorrect={false}
                  textContentType="none"
                  importantForAutofill="no"
                />
                <Text style={styles.fieldHint}>
                  🔒 Zero-Knowledge encrypted with OpenPGP client cryptography.
                </Text>
              </View>
            )}

            {/* PAYMENT CARD FIELDS */}
            {entryType === 'card' && (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Card Number</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Card number"
                    placeholderTextColor={colors.textMuted}
                    value={cardNumber}
                    onChangeText={setCardNumber}
                    keyboardType="number-pad"
                    autoComplete="off"
                    autoCorrect={false}
                    textContentType="none"
                    importantForAutofill="no"
                  />
                </View>

                <View style={styles.splitRow}>
                  <View style={[styles.fieldGroup, { flex: 1 }]}>
                    <Text style={styles.label}>Expires</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="MM/YY"
                      placeholderTextColor={colors.textMuted}
                      value={expiry}
                      onChangeText={setExpiry}
                      maxLength={5}
                      autoComplete="off"
                      autoCorrect={false}
                      textContentType="none"
                      importantForAutofill="no"
                    />
                  </View>

                  <View style={[styles.fieldGroup, { flex: 1 }]}>
                    <Text style={styles.label}>CVV / CVC</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="CVV"
                      placeholderTextColor={colors.textMuted}
                      value={cvv}
                      onChangeText={setCvv}
                      keyboardType="number-pad"
                      secureTextEntry
                      maxLength={4}
                      autoComplete="off"
                      autoCorrect={false}
                      textContentType="none"
                      importantForAutofill="no"
                    />
                  </View>
                </View>
              </>
            )}

            {/* LOGIN / PASSWORD FIELDS */}
            {entryType === 'login' && (
              <>
                {/* Username */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Username / Email</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Username or email"
                    placeholderTextColor={colors.textMuted}
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect={false}
                    textContentType="none"
                    importantForAutofill="no"
                  />
                </View>

                {/* URL */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Website URL</Text>
                  <TextInput
                    style={[styles.input, !!urlError && styles.inputError]}
                    placeholder="Website URL"
                    placeholderTextColor={colors.textMuted}
                    value={url}
                    onChangeText={(text) => {
                      setUrl(text);
                      if (urlError) setUrlError('');
                    }}
                    autoCapitalize="none"
                    keyboardType="url"
                    autoComplete="off"
                    autoCorrect={false}
                    textContentType="none"
                    importantForAutofill="no"
                  />
                  {!!urlError && <Text style={styles.errorText}>{urlError}</Text>}
                </View>

                {/* Password Field */}
                <View style={styles.fieldGroup}>
                  <View style={styles.passwordLabelRow}>
                    <Text style={styles.label}>Password</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <TouchableOpacity
                        style={styles.autoGenHeaderBtn}
                        onPress={() => {
                          handleGenerate();
                          setShowPassword(true);
                        }}
                        activeOpacity={0.7}
                      >
                        <LucideRotateCcw size={11} color={colors.cyan} strokeWidth={2.2} />
                        <Text style={styles.autoGenHeaderText}>Auto-generate</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.generateToggleBtn,
                          showGenerator && styles.generateToggleBtnActive,
                        ]}
                        onPress={() => setShowGenerator(!showGenerator)}
                        activeOpacity={0.7}
                      >
                        <LucideSparkles size={11} color={showGenerator ? colors.cyan : colors.textMuted} strokeWidth={2} />
                        <Text style={[styles.generateToggle, showGenerator && { color: colors.cyan }]}>
                          Options
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.passwordInputContainer}>
                    <TextInput
                      style={styles.passwordInputWithEye}
                      placeholder="Password"
                      placeholderTextColor={colors.textMuted}
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoComplete="off"
                      autoCorrect={false}
                      textContentType="none"
                      importantForAutofill="no"
                    />
                    <TouchableOpacity
                      style={styles.passwordEyeBtn}
                      onPress={() => setShowPassword(!showPassword)}
                      activeOpacity={0.7}
                    >
                      {showPassword ? (
                        <EyeOffIcon size={16} color={colors.textMuted} />
                      ) : (
                        <EyeIcon size={16} color={colors.textMuted} />
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Password Strength Indicator */}
                  {password.length > 0 && (
                    <View style={styles.strengthContainer}>
                      <View style={styles.strengthBarBg}>
                        <View
                          style={[
                            styles.strengthBarFill,
                            {
                              width: `${strength.score}%`,
                              backgroundColor:
                                strength.tier === 'Strong'
                                  ? colors.success
                                  : strength.tier === 'Good'
                                  ? '#38BDF8'
                                  : strength.tier === 'Better'
                                  ? colors.warning
                                  : colors.danger,
                            },
                          ]}
                        />
                      </View>
                      <Text
                        style={[
                          styles.strengthText,
                          {
                            color:
                              strength.tier === 'Strong'
                                ? colors.success
                                : strength.tier === 'Good'
                                ? '#38BDF8'
                                : strength.tier === 'Better'
                                ? colors.warning
                                : colors.danger,
                          },
                        ]}
                      >
                        {strength.tier} ({strength.score}/100)
                      </Text>
                    </View>
                  )}
                </View>

                {/* Password Generator Panel */}
                {showGenerator && (
                  <View style={styles.generatorBox}>
                    <Text style={styles.genTitle}>Password Length: {passLength}</Text>
                    <View style={styles.lengthPicker}>
                      {[12, 16, 20, 24, 32].map((len) => (
                        <TouchableOpacity
                          key={len}
                          style={[styles.lengthChip, passLength === len && styles.lengthChipActive]}
                          onPress={() => {
                            setPassLength(len);
                            handleGenerate(len);
                            setShowPassword(true);
                          }}
                        >
                          <Text
                            style={[
                              styles.lengthChipText,
                              passLength === len && styles.lengthChipTextActive,
                            ]}
                          >
                            {len}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <View style={styles.genOptionRow}>
                      <Text style={styles.genOptionLabel}>Uppercase Letters (A-Z)</Text>
                      <Switch
                        value={incUppercase}
                        onValueChange={(val) => {
                          setIncUppercase(val);
                          handleGenerate(undefined, val);
                        }}
                        trackColor={{ false: colors.surface2, true: colors.cyanDim }}
                        thumbColor={incUppercase ? colors.cyan : colors.textMuted}
                      />
                    </View>

                    <View style={styles.genOptionRow}>
                      <Text style={styles.genOptionLabel}>Numbers (0-9)</Text>
                      <Switch
                        value={incNumbers}
                        onValueChange={(val) => {
                          setIncNumbers(val);
                          handleGenerate(undefined, undefined, val);
                        }}
                        trackColor={{ false: colors.surface2, true: colors.cyanDim }}
                        thumbColor={incNumbers ? colors.cyan : colors.textMuted}
                      />
                    </View>

                    <View style={styles.genOptionRow}>
                      <Text style={styles.genOptionLabel}>Special Symbols (!@#$)</Text>
                      <Switch
                        value={incSymbols}
                        onValueChange={(val) => {
                          setIncSymbols(val);
                          handleGenerate(undefined, undefined, undefined, val);
                        }}
                        trackColor={{ false: colors.surface2, true: colors.cyanDim }}
                        thumbColor={incSymbols ? colors.cyan : colors.textMuted}
                      />
                    </View>

                    <View style={styles.genButtonsRow}>
                      <TouchableOpacity
                        style={[
                          styles.genBtn,
                          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
                        ]}
                        onPress={() => {
                          handleGenerate();
                          setShowPassword(true);
                        }}
                        activeOpacity={0.8}
                      >
                        <LucideRotateCcw size={13} color={colors.cyan} strokeWidth={2} />
                        <Text style={styles.genBtnText}>Regenerate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.genBtn, styles.passphraseBtn, { flex: 1 }]}
                        onPress={() => {
                          const phrase = generatePassphrase(4);
                          setPassword(phrase);
                          setShowPassword(true);
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.genBtnText, { color: colors.warning }]}>
                          Diceware Passphrase
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* Secure Note Field (Available in both Personal & Organization mode) */}
                <View style={styles.fieldGroup}>
                  <View style={styles.noteHeaderRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <LucideFileText size={12} color={colors.cyan} />
                      <Text style={styles.label}>Secure Note</Text>
                    </View>
                    <Text style={styles.noteCount}>
                      {noteContent.length} chars
                    </Text>
                  </View>
                  <TextInput
                    style={styles.noteTextArea}
                    placeholder="Add confidential notes, recovery phrases, server ports, or private memos..."
                    placeholderTextColor={colors.textMuted}
                    value={noteContent}
                    onChangeText={setNoteContent}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                    autoComplete="off"
                    autoCorrect={false}
                    textContentType="none"
                    importantForAutofill="no"
                  />
                  <Text style={styles.fieldHint}>
                    🔒 Zero-Knowledge encrypted with OpenPGP client cryptography.
                  </Text>
                </View>
              </>
            )}

            {/* Folder Picker */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Folder</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.folderScroll}>
                <TouchableOpacity
                  style={[
                    styles.folderChip,
                    !selectedFolderId && styles.folderChipActive,
                  ]}
                  onPress={() => setSelectedFolderId('')}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <LucideFolder
                      size={12}
                      color={!selectedFolderId ? '#062229' : colors.textMuted}
                    />
                    <Text
                      style={[
                        styles.folderChipText,
                        !selectedFolderId && styles.folderChipTextActive,
                      ]}
                    >
                      None (Vault Root)
                    </Text>
                  </View>
                </TouchableOpacity>

                {folders.map((f) => {
                  const isSelected = selectedFolderId === f.id;
                  return (
                    <TouchableOpacity
                      key={f.id}
                      style={[
                        styles.folderChip,
                        isSelected && styles.folderChipActive,
                      ]}
                      onPress={() => setSelectedFolderId(f.id)}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <LucideFolder
                          size={12}
                          color={isSelected ? '#062229' : colors.warning}
                        />
                        <Text
                          style={[
                            styles.folderChipText,
                            isSelected && styles.folderChipTextActive,
                          ]}
                        >
                          {f.name}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Save Button */}
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#062229" />
              ) : (
                <Text style={styles.saveBtnText}>
                  {editItem ? 'Save Changes' : entryType === 'note' ? 'Save Secure Note' : 'Save to Vault'}
                </Text>
              )}
            </TouchableOpacity>
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
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      maxHeight: '90%',
      paddingBottom: 24,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  closeBtnText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '600',
  },
  typeSelector: {
    flexDirection: 'row',
    paddingHorizontal: 18,
    paddingTop: 12,
    gap: 8,
  },
  typePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    borderRadius: 9,
  },
  typePillActive: {
    backgroundColor: colors.cyanBg,
    borderColor: colors.cyan,
  },
  typePillText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.textMuted,
  },
  typePillTextActive: {
    color: colors.cyan,
    fontWeight: '700',
  },
  formBody: {
    maxHeight: 520,
  },
  formContent: {
    padding: 20,
    gap: 14,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  input: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.text,
  },
  noteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  noteCount: {
    fontSize: 10.5,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  noteTextArea: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.text,
    minHeight: 120,
    lineHeight: 18,
  },
  inputError: {
    borderColor: colors.danger,
  },
  errorText: {
    color: colors.danger,
    fontSize: 11,
    marginTop: 2,
  },
  passwordLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  autoGenHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.cyanBg,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
  },
  autoGenHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.cyan,
  },
  generateToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  generateToggleBtnActive: {
    backgroundColor: colors.cyanBg,
    borderColor: colors.cyanBorder,
  },
  generateToggle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
  },
  passwordInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  passwordInputWithEye: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '700',
  },
  passwordEyeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.cyanBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
  },
  scanBtnText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: colors.cyan,
  },
  fieldHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  strengthContainer: {
    gap: 4,
    marginTop: 4,
  },
  strengthBarBg: {
    height: 4,
    backgroundColor: colors.surface2,
    borderRadius: 2,
    overflow: 'hidden',
  },
  strengthBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  strengthText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  folderScroll: {
    flexDirection: 'row',
    marginTop: 2,
  },
  folderChip: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
  },
  folderChipActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanBg,
  },
  folderChipText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  folderChipTextActive: {
    color: colors.cyan,
    fontWeight: '600',
  },
  generatorBox: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  genTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  lengthPicker: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  lengthChip: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 7,
    paddingVertical: 6,
    alignItems: 'center',
  },
  lengthChipActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanBg,
  },
  lengthChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  lengthChipTextActive: {
    color: colors.cyan,
  },
  genButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  passphraseBtn: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warningBorder,
  },
  genOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  genOptionLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  genBtn: {
    backgroundColor: colors.cyanBg,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 6,
  },
  genBtnText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: '600',
  },
  splitRow: {
    flexDirection: 'row',
    gap: 12,
  },
  saveBtn: {
    backgroundColor: colors.cyan,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: {
    color: '#062229',
    fontSize: 14,
    fontWeight: '700',
  },
});
