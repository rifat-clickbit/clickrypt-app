import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { colors } from '../theme/colors';
import { NavPasswordsIcon, CheckIcon } from './Icons';
import { parsePasswordCsv, ParsedCsvItem } from '../services/csvImporter';
import { useVault } from '../context/VaultContext';
import { useTheme } from '../theme/ThemeContext';
import { sendSecurityAlert } from '../services/notificationService';

interface ImportModalProps {
  visible: boolean;
  onClose: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({ visible, onClose }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { createItem } = useVault();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedItems, setParsedItems] = useState<ParsedCsvItem[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const response = await fetch(asset.uri);
        const text = await response.text();

        const items = parsePasswordCsv(text);
        setFileName(asset.name);
        setParsedItems(items);
      }
    } catch (err: any) {
      Alert.alert('CSV Import Error', err?.message || 'Failed to read or parse the selected file.');
    }
  };

  const handleExecuteImport = async () => {
    if (parsedItems.length === 0) return;
    setIsImporting(true);
    setProgress(0);

    try {
      let successCount = 0;
      for (let i = 0; i < parsedItems.length; i++) {
        const item = parsedItems[i];
        const ok = await createItem({
          name: item.name,
          username: item.username,
          url: item.url,
          password: item.password,
        });
        if (ok) successCount++;
        setProgress(i + 1);
      }

      await sendSecurityAlert({
        title: 'Vault Import Complete',
        body: `Successfully encrypted and imported ${successCount} passwords to your vault.`,
      });

      Alert.alert(
        'Import Complete',
        `Successfully imported ${successCount} passwords into your encrypted vault.`
      );
      setFileName(null);
      setParsedItems([]);
      onClose();
    } catch (err: any) {
      Alert.alert('Import Failed', err?.message || 'An error occurred while importing passwords.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Import Passwords from CSV</Text>
            <TouchableOpacity onPress={onClose} disabled={isImporting} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text style={styles.desc}>
              Import credentials exported from **Bitwarden**, **1Password**, **LastPass**, or **Google
              Chrome**. Every password will be encrypted client-side using OpenPGP before storing.
            </Text>

            {/* Choose File Button */}
            {!fileName ? (
              <TouchableOpacity
                style={styles.pickFileBtn}
                activeOpacity={0.8}
                onPress={handlePickFile}
              >
                <NavPasswordsIcon size={24} color={colors.cyan} />
                <Text style={styles.pickFileTitle}>Select CSV Export File</Text>
                <Text style={styles.pickFileSub}>Supports .csv files from major password managers</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.fileSelectedBox}>
                <View style={styles.fileInfoRow}>
                  <View style={styles.fileBadge}>
                    <CheckIcon size={16} color={colors.cyan} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fileName}>{fileName}</Text>
                    <Text style={styles.fileCount}>
                      Found {parsedItems.length} credentials ready to import
                    </Text>
                  </View>
                  {!isImporting && (
                    <TouchableOpacity onPress={() => { setFileName(null); setParsedItems([]); }}>
                      <Text style={styles.changeFileText}>Change</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Preview list */}
                <View style={styles.previewContainer}>
                  <Text style={styles.previewTitle}>PREVIEW (First 5 Items)</Text>
                  {parsedItems.slice(0, 5).map((item, idx) => (
                    <View key={idx} style={styles.previewRow}>
                      <Text style={styles.previewName}>{item.name}</Text>
                      <Text style={styles.previewUser}>{item.username || 'no username'}</Text>
                    </View>
                  ))}
                </View>

                {/* Progress bar */}
                {isImporting && (
                  <View style={styles.progressContainer}>
                    <Text style={styles.progressText}>
                      Encrypting & Saving ({progress} of {parsedItems.length})...
                    </Text>
                    <ActivityIndicator color={colors.cyan} style={{ marginTop: 6 }} />
                  </View>
                )}

                {/* Submit Import */}
                <TouchableOpacity
                  style={styles.importBtn}
                  activeOpacity={0.8}
                  disabled={isImporting}
                  onPress={handleExecuteImport}
                >
                  <Text style={styles.importBtnText}>
                    {isImporting
                      ? `Importing (${progress}/${parsedItems.length})...`
                      : `Encrypt & Import ${parsedItems.length} Items`}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const createStyles = (colors: any) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 12, 0.75)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: 20,
  },
  bodyContent: {
    paddingVertical: 18,
    gap: 16,
    paddingBottom: 40,
  },
  desc: {
    fontSize: 12.5,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  pickFileBtn: {
    backgroundColor: colors.surface2,
    borderWidth: 1.5,
    borderColor: colors.cyanBorder,
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 8,
  },
  pickFileTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.cyan,
  },
  pickFileSub: {
    fontSize: 11,
    color: colors.textMuted,
  },
  fileSelectedBox: {
    gap: 14,
  },
  fileInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
  },
  fileBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.cyanBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  fileCount: {
    fontSize: 11,
    color: colors.cyan,
    marginTop: 2,
  },
  changeFileText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  previewContainer: {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  previewTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
  },
  previewName: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.text,
  },
  previewUser: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  progressContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  progressText: {
    fontSize: 12,
    color: colors.cyan,
    fontWeight: '600',
  },
  importBtn: {
    backgroundColor: colors.cyan,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  importBtnText: {
    color: '#062229',
    fontSize: 14,
    fontWeight: '700',
  },
});
