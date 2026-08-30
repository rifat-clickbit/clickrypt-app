import React, { useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { colors } from '../theme/colors';
import {
  LucideRotateCcw,
  LucideTrash2,
  LucideFileText,
  NavPasswordsIcon,
  NavCardsIcon,
} from './Icons';
import { useVault } from '../context/VaultContext';
import { useTheme } from '../theme/ThemeContext';
import { VaultItem } from '../types';

interface TrashModalProps {
  visible: boolean;
  onClose: () => void;
}

export const TrashModal: React.FC<TrashModalProps> = ({ visible, onClose }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { items, restoreItem, purgeItem, emptyTrash, folders } = useVault();

  const deletedItems = items.filter((i) => i.isDeleted);

  const handleEmptyTrash = () => {
    Alert.alert(
      'Empty Trash',
      `Permanently delete all ${deletedItems.length} item(s)? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Empty Trash',
          style: 'destructive',
          onPress: async () => {
            await emptyTrash();
          },
        },
      ]
    );
  };

  const handlePurgeSingle = (item: VaultItem) => {
    Alert.alert(
      'Delete Forever',
      `Permanently delete "${item.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Forever',
          style: 'destructive',
          onPress: async () => {
            await purgeItem(item.id);
          },
        },
      ]
    );
  };

  const handleRestoreSingle = async (item: VaultItem) => {
    await restoreItem(item.id);
    Alert.alert('Item Restored', `"${item.name}" has been restored to your active vault.`);
  };

  const getItemIcon = (item: VaultItem) => {
    if (item.itemType === 'note') {
      return {
        icon: <LucideFileText size={18} color={colors.cyan} />,
        bg: colors.cyanBg,
        border: colors.cyanBorder,
        typeLabel: 'Secure Note',
      };
    }
    if (item.itemType === 'card' || item.isPrivateOnly) {
      return {
        icon: <NavCardsIcon size={18} color="#38BDF8" />,
        bg: 'rgba(56, 189, 248, 0.12)',
        border: 'rgba(56, 189, 248, 0.3)',
        typeLabel: 'Payment Card',
      };
    }
    return {
      icon: <NavPasswordsIcon size={18} color={colors.warning} />,
      bg: colors.warningBg,
      border: colors.warningBorder,
      typeLabel: 'Login Password',
    };
  };

  const formatDeletedDate = (isoString?: string) => {
    if (!isoString) return 'Recently deleted';
    try {
      const d = new Date(isoString);
      return `Deleted ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return 'Recently deleted';
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconBg}>
                <LucideTrash2 size={18} color={colors.danger} />
              </View>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.headerTitle}>Trash & Recycle Bin</Text>
                  {deletedItems.length > 0 && (
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>{deletedItems.length}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.headerSubtitle}>Items moved to trash can be restored or purged</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Action Bar */}
          {deletedItems.length > 0 && (
            <View style={styles.actionRow}>
              <Text style={styles.autoPurgeNotice}>
                Items remain safely in trash until emptied.
              </Text>
              <TouchableOpacity
                style={styles.emptyTrashBtn}
                onPress={handleEmptyTrash}
                activeOpacity={0.7}
              >
                <LucideTrash2 size={13} color={colors.danger} />
                <Text style={styles.emptyTrashText}>Empty Trash</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Deleted Items List */}
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {deletedItems.length === 0 ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconBg}>
                  <LucideTrash2 size={32} color={colors.textMuted} />
                </View>
                <Text style={styles.emptyTitle}>Trash is Empty</Text>
                <Text style={styles.emptySubtitle}>
                  Deleted passwords, cards, and secure notes will appear here where you can restore them anytime.
                </Text>
              </View>
            ) : (
              deletedItems.map((item) => {
                const config = getItemIcon(item);
                const folder = folders.find((f) => f.id === item.folderId);
                return (
                  <View key={item.id} style={styles.trashCard}>
                    <View style={styles.cardTop}>
                      <View
                        style={[
                          styles.itemIconBg,
                          { backgroundColor: config.bg, borderColor: config.border },
                        ]}
                      >
                        {config.icon}
                      </View>

                      <View style={styles.itemMeta}>
                        <Text style={styles.itemName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <View style={styles.itemSubRow}>
                          <Text style={styles.itemType}>{config.typeLabel}</Text>
                          {folder && (
                            <Text style={styles.folderPill}>📁 {folder.name}</Text>
                          )}
                        </View>
                        <Text style={styles.deletedDate}>
                          {formatDeletedDate(item.deletedAt)}
                        </Text>
                      </View>
                    </View>

                    {/* Card Actions */}
                    <View style={styles.cardActions}>
                      <TouchableOpacity
                        style={styles.restoreBtn}
                        onPress={() => handleRestoreSingle(item)}
                        activeOpacity={0.7}
                      >
                        <LucideRotateCcw size={13} color={colors.cyan} />
                        <Text style={styles.restoreBtnText}>Restore</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.purgeBtn}
                        onPress={() => handlePurgeSingle(item)}
                        activeOpacity={0.7}
                      >
                        <LucideTrash2 size={13} color={colors.danger} />
                        <Text style={styles.purgeBtnText}>Delete Forever</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const createStyles = (colors: any) =>
  StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.overlayBg,
      justifyContent: 'flex-end',
    },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  headerIconBg: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  countBadge: {
    backgroundColor: colors.danger,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 8,
  },
  countBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: 'rgba(248, 113, 113, 0.05)',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  autoPurgeNotice: {
    fontSize: 11,
    color: colors.textMuted,
    flex: 1,
  },
  emptyTrashBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: colors.dangerBg,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  emptyTrashText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.danger,
  },
  list: {
    marginTop: 10,
    paddingHorizontal: 18,
    maxHeight: 440,
  },
  listContent: {
    gap: 10,
    paddingBottom: 20,
  },
  trashCard: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  cardTop: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  itemIconBg: {
    width: 36,
    height: 36,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  itemMeta: {
    flex: 1,
    gap: 2,
  },
  itemName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.text,
  },
  itemSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 1,
  },
  itemType: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  folderPill: {
    fontSize: 10.5,
    color: colors.textMuted,
  },
  deletedDate: {
    fontSize: 10.5,
    color: colors.danger,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  restoreBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    backgroundColor: colors.cyanBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
  },
  restoreBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.cyan,
  },
  purgeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    backgroundColor: colors.dangerBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  purgeBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.danger,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyIconBg: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  emptySubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 16,
  },
});
