import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { colors } from '../theme/colors';
import { Header } from '../components/Header';
import { FilterSheet } from '../components/FilterSheet';
import { PasswordCard } from '../components/PasswordCard';
import { PasswordDrawerModal } from '../components/PasswordDrawerModal';
import { ShareModal } from '../components/ShareModal';
import {
  BulkSelectIcon,
  SyncIcon,
  ChevronRightIcon,
  BackIcon,
  FolderIcon,
  CheckIcon,
  TrashIcon,
  LucideFolder,
  LucidePlus,
  LucideKeyRound as KeyRound,
  LucideInbox as Inbox,
  LucideSend as Send,
  LucideShare2 as Share2,
} from '../components/Icons';
import { useVault } from '../context/VaultContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../services/supabaseClient';
import { VaultItem } from '../types';

export const PasswordsScreen = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, appMode } = useAuth();
  const {
    items,
    folders,
    isLoading,
    isSyncing,
    filterMode,
    setFilterMode,
    selectedFolderId,
    setSelectedFolderId,
    searchQuery,
    deleteItem,
    batchMoveToFolder,
    refreshVault,
  } = useVault();

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareItem, setShareItem] = useState<VaultItem | null>(null);
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null);

  // Bulk selection state
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const isSharedWithMe = (item: VaultItem) => {
    return (
      item.ownerId !== user?.id &&
      (item.sharedWith?.includes(user?.id || '') || item.isExternalShared)
    );
  };

  const isSharedByMe = (item: VaultItem) => {
    return (
      item.ownerId === user?.id &&
      ((item.sharedWith && item.sharedWith.length > 0) || item.isExternalShared)
    );
  };

  const isOwnPrivate = (item: VaultItem) => {
    return (
      item.ownerId === user?.id &&
      !item.isExternalShared &&
      (!item.sharedWith || item.sharedWith.length === 0)
    );
  };

  // Filter items based on active search, folder, and filter mode
  const filteredItems = items.filter((item) => {
    if (item.isPrivateOnly) return false;

    // Filter by trash mode
    if (filterMode === 'trash') {
      return !!item.isDeleted;
    }
    // Normal filters should exclude deleted items
    if (item.isDeleted) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = (item.name || '').toLowerCase().includes(q);
      const matchUser = (item.username || '').toLowerCase().includes(q);
      const matchUrl = (item.url || '').toLowerCase().includes(q);
      const matchNote = (item.noteContent || '').toLowerCase().includes(q);
      if (!matchName && !matchUser && !matchUrl && !matchNote) return false;
    }

    if (selectedFolderId && item.folderId !== selectedFolderId) {
      return false;
    }

    if (filterMode === 'notes') return item.itemType === 'note';
    if (filterMode === 'leaked') return !!item.isLeaked;
    if (filterMode === 'outdated') return !!item.isOld;
    if (filterMode === 'sharedWithMe') return isSharedWithMe(item);
    if (filterMode === 'sharedByMe') return isSharedByMe(item);
    if (filterMode === 'own') return isOwnPrivate(item);

    return true;
  });

  const selectedFolder = folders.find((f) => f.id === selectedFolderId);
  const selectedFolderName = selectedFolder ? selectedFolder.name : 'All Folders';

  const activeItems = items.filter((i) => !i.isPrivateOnly && !i.isDeleted);
  const filterCounts = {
    all: activeItems.length,
    notes: activeItems.filter((i) => i.itemType === 'note').length,
    sharedWithMe: activeItems.filter((i) => isSharedWithMe(i)).length,
    sharedByMe: activeItems.filter((i) => isSharedByMe(i)).length,
    own: activeItems.filter((i) => isOwnPrivate(i)).length,
    leaked: activeItems.filter((i) => i.isLeaked).length,
    outdated: activeItems.filter((i) => i.isOld).length,
    lastModified: activeItems.length,
    trash: items.filter((i) => !i.isPrivateOnly && i.isDeleted).length,
  };

  const handleEdit = (item: VaultItem) => {
    setEditingItem(item);
    setIsDrawerOpen(true);
  };

  const handleAdd = () => {
    setEditingItem(null);
    setIsDrawerOpen(true);
  };

  const handleShare = (item: VaultItem) => {
    setShareItem(item);
    setIsShareModalOpen(true);
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedIds.length === filteredItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredItems.map((i) => i.id));
    }
  };

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    Alert.alert(
      'Delete Selected',
      `Are you sure you want to delete ${selectedIds.length} items from your vault?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            for (const id of selectedIds) {
              await deleteItem(id);
            }
            setSelectedIds([]);
            setIsBulkMode(false);
          },
        },
      ]
    );
  };

  const handleBatchMove = async (targetFolderId: string | null) => {
    if (selectedIds.length === 0) return;
    const success = await batchMoveToFolder(selectedIds, targetFolderId);
    if (success) {
      const targetFolder = folders.find((f) => f.id === targetFolderId);
      const targetName = targetFolder ? targetFolder.name : 'Root Vault';
      Alert.alert('Moved to Folder', `Successfully moved ${selectedIds.length} item(s) to "${targetName}".`);
      setSelectedIds([]);
      setIsBulkMode(false);
      setIsMoveModalOpen(false);
      setIsCreatingFolder(false);
    }
  };

  const handleCreateAndMove = async () => {
    if (!newFolderName.trim()) return;
    try {
      const newFld = {
        id: `fld-${Date.now()}`,
        name: newFolderName.trim(),
        mode: appMode,
        color: '#FBBF24',
        itemCount: 0,
        createdAt: new Date().toISOString(),
      };
      await supabase.from('folders').insert({
        id: newFld.id,
        name: newFld.name,
        mode: appMode,
        data: newFld,
      });
      await refreshVault();
      await handleBatchMove(newFld.id);
      setNewFolderName('');
      setIsCreatingFolder(false);
    } catch {
      Alert.alert('Error', 'Failed to create folder.');
    }
  };

  return (
    <View style={styles.container}>
      {/* App Header with Search, Title, Add button & Filter selectors */}
      <Header
        title="Passwords"
        itemCount={filteredItems.length}
        onAddPress={handleAdd}
      />

      {/* Vault Mode Dedicated Sharing Segment Tabs */}
      {appMode === 'organization' ? (
        <View style={styles.orgSegmentBar}>
          <TouchableOpacity
            style={[
              styles.orgSegmentTab,
              filterMode !== 'sharedWithMe' &&
                filterMode !== 'sharedByMe' &&
                styles.orgSegmentTabActive,
            ]}
            onPress={() => setFilterMode('all')}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <KeyRound
                size={12}
                color={
                  filterMode !== 'sharedWithMe' && filterMode !== 'sharedByMe'
                    ? colors.cyan
                    : colors.textMuted
                }
              />
              <Text
                style={[
                  styles.orgSegmentText,
                  filterMode !== 'sharedWithMe' &&
                    filterMode !== 'sharedByMe' &&
                    styles.orgSegmentTextActive,
                ]}
              >
                All ({filterCounts.all})
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.orgSegmentTab,
              filterMode === 'sharedWithMe' && styles.orgSegmentTabActive,
            ]}
            onPress={() => setFilterMode('sharedWithMe')}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Inbox
                size={12}
                color={filterMode === 'sharedWithMe' ? colors.cyan : colors.textMuted}
              />
              <Text
                style={[
                  styles.orgSegmentText,
                  filterMode === 'sharedWithMe' && styles.orgSegmentTextActive,
                ]}
              >
                Shared with me ({filterCounts.sharedWithMe})
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.orgSegmentTab, filterMode === 'sharedByMe' && styles.orgSegmentTabActive]}
            onPress={() => setFilterMode('sharedByMe')}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Send
                size={12}
                color={filterMode === 'sharedByMe' ? colors.cyan : colors.textMuted}
              />
              <Text
                style={[
                  styles.orgSegmentText,
                  filterMode === 'sharedByMe' && styles.orgSegmentTextActive,
                ]}
              >
                Shared by me ({filterCounts.sharedByMe})
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      ) : (
        /* Personal Mode Top Segment: All Vault & Shared by me */
        <View style={styles.orgSegmentBar}>
          <TouchableOpacity
            style={[
              styles.orgSegmentTab,
              filterMode !== 'sharedByMe' && styles.orgSegmentTabActive,
            ]}
            onPress={() => setFilterMode('all')}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <KeyRound
                size={12}
                color={filterMode !== 'sharedByMe' ? colors.cyan : colors.textMuted}
              />
              <Text
                style={[
                  styles.orgSegmentText,
                  filterMode !== 'sharedByMe' && styles.orgSegmentTextActive,
                ]}
              >
                All Passwords ({filterCounts.all})
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.orgSegmentTab, filterMode === 'sharedByMe' && styles.orgSegmentTabActive]}
            onPress={() => setFilterMode('sharedByMe')}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Send
                size={12}
                color={filterMode === 'sharedByMe' ? colors.cyan : colors.textMuted}
              />
              <Text
                style={[
                  styles.orgSegmentText,
                  filterMode === 'sharedByMe' && styles.orgSegmentTextActive,
                ]}
              >
                Shared by me ({filterCounts.sharedByMe})
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Bulk selection row & Realtime Sync Indicator */}
      <View style={styles.bulkRow}>
        <TouchableOpacity
          style={[styles.bulkBtn, isBulkMode && styles.bulkBtnActive]}
          activeOpacity={0.7}
          onPress={() => {
            setIsBulkMode(!isBulkMode);
            setSelectedIds([]);
          }}
        >
          <BulkSelectIcon
            size={13}
            color={isBulkMode ? colors.cyan : colors.textSecondary}
          />
          <Text style={[styles.bulkBtnText, isBulkMode && { color: colors.cyan }]}>
            {isBulkMode ? 'Cancel Selection' : 'Bulk select'}
          </Text>
        </TouchableOpacity>

        <View style={styles.sortHint}>
          {isSyncing ? (
            <ActivityIndicator size="small" color={colors.cyan} />
          ) : (
            <SyncIcon size={11} color={colors.textMuted} />
          )}
          <Text style={styles.sortHintText}>{isSyncing ? 'syncing...' : 'synced'}</Text>
        </View>
      </View>

      {/* Floating Batch Action Bar when in Bulk Select Mode */}
      {isBulkMode && (
        <View style={styles.batchActionBar}>
          <TouchableOpacity style={styles.batchSubBtn} onPress={handleSelectAll}>
            <Text style={styles.batchSubText}>
              {selectedIds.length === filteredItems.length ? 'Deselect All' : 'Select All'}
            </Text>
          </TouchableOpacity>

          <View style={styles.batchActionRight}>
            <TouchableOpacity
              style={[styles.batchMoveBtn, selectedIds.length === 0 && { opacity: 0.4 }]}
              disabled={selectedIds.length === 0}
              onPress={() => setIsMoveModalOpen(true)}
            >
              <LucideFolder size={13} color={colors.cyan} strokeWidth={2} />
              <Text style={styles.batchMoveText}>Move ({selectedIds.length})</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.batchDeleteBtn, selectedIds.length === 0 && { opacity: 0.4 }]}
              disabled={selectedIds.length === 0}
              onPress={handleBatchDelete}
            >
              <TrashIcon size={13} color={colors.danger} />
              <Text style={styles.batchDeleteText}>Delete ({selectedIds.length})</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Password Vault Items List (Infinite Scroll) */}
      <ScrollView
        style={styles.vaultList}
        contentContainerStyle={styles.vaultListContent}
        showsVerticalScrollIndicator={false}
      >
        {isLoading && items.length === 0 ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator size="large" color={colors.cyan} />
          </View>
        ) : filteredItems.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {filterMode === 'sharedWithMe'
                ? 'No passwords shared with you'
                : filterMode === 'sharedByMe'
                ? 'No passwords shared by you'
                : 'No passwords found'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {filterMode === 'sharedWithMe'
                ? 'Passwords shared by colleagues in your organization will appear here.'
                : filterMode === 'sharedByMe'
                ? 'Tap "Share" on any password card to provision access to colleagues.'
                : 'Tap "+ Add" to save a new credential.'}
            </Text>
          </View>
        ) : (
          filteredItems.map((item, index) => (
            <PasswordCard
              key={item.id}
              item={item}
              initialExpanded={index === 0 && !isBulkMode}
              isBulkMode={isBulkMode}
              isSelected={selectedIds.includes(item.id)}
              onToggleSelect={handleToggleSelect}
              onEdit={handleEdit}
              onShare={handleShare}
              onDelete={deleteItem}
            />
          ))
        )}
      </ScrollView>

      {/* Move to Folder Modal Sheet */}
      <Modal
        visible={isMoveModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setIsMoveModalOpen(false);
          setIsCreatingFolder(false);
        }}
      >
        <View style={styles.moveModalOverlay}>
          <View style={styles.moveModalContent}>
            <View style={styles.moveModalHeader}>
              <View>
                <Text style={styles.moveModalTitle}>Move to Folder</Text>
                <Text style={styles.moveModalSub}>
                  Select destination for {selectedIds.length} selected item(s)
                </Text>
              </View>
              <TouchableOpacity
                style={styles.moveCloseBtn}
                onPress={() => {
                  setIsMoveModalOpen(false);
                  setIsCreatingFolder(false);
                }}
              >
                <Text style={styles.moveCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.moveFolderList} showsVerticalScrollIndicator={false}>
              {/* Option: Root Vault (No Folder) */}
              <TouchableOpacity
                style={styles.moveFolderOpt}
                activeOpacity={0.7}
                onPress={() => handleBatchMove(null)}
              >
                <View style={styles.moveFolderOptLeft}>
                  <View style={[styles.folderIconBadge, { backgroundColor: colors.surface2 }]}>
                    <LucideFolder size={17} color={colors.textMuted} />
                  </View>
                  <View>
                    <Text style={styles.moveFolderOptName}>Root Vault</Text>
                    <Text style={styles.moveFolderOptSub}>No specific folder</Text>
                  </View>
                </View>
                <ChevronRightIcon size={14} color={colors.textMuted} />
              </TouchableOpacity>

              {/* User folders */}
              {folders.map((folder) => {
                const count = items.filter(
                  (i) => !i.isDeleted && i.folderId === folder.id
                ).length;
                return (
                  <TouchableOpacity
                    key={folder.id}
                    style={styles.moveFolderOpt}
                    activeOpacity={0.7}
                    onPress={() => handleBatchMove(folder.id)}
                  >
                    <View style={styles.moveFolderOptLeft}>
                      <View
                        style={[
                          styles.folderIconBadge,
                          { backgroundColor: colors.warningBg },
                        ]}
                      >
                        <LucideFolder
                          size={17}
                          color={folder.color || colors.warning}
                        />
                      </View>
                      <View>
                        <Text style={styles.moveFolderOptName}>{folder.name}</Text>
                        <Text style={styles.moveFolderOptSub}>
                          {count} item{count === 1 ? '' : 's'}
                        </Text>
                      </View>
                    </View>
                    <ChevronRightIcon size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                );
              })}

              {/* Create New Folder Inline */}
              {isCreatingFolder ? (
                <View style={styles.newFolderBox}>
                  <TextInput
                    style={styles.newFolderInput}
                    placeholder="New folder name..."
                    placeholderTextColor={colors.textMuted}
                    value={newFolderName}
                    onChangeText={setNewFolderName}
                    autoFocus
                  />
                  <View style={styles.newFolderActions}>
                    <TouchableOpacity
                      style={styles.newFolderCancelBtn}
                      onPress={() => setIsCreatingFolder(false)}
                    >
                      <Text style={styles.newFolderCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.newFolderCreateBtn}
                      onPress={handleCreateAndMove}
                    >
                      <Text style={styles.newFolderCreateText}>Create & Move</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.addNewFolderBtn}
                  activeOpacity={0.7}
                  onPress={() => setIsCreatingFolder(true)}
                >
                  <LucidePlus size={15} color={colors.cyan} strokeWidth={2.5} />
                  <Text style={styles.addNewFolderText}>Create New Folder</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Add / Edit Drawer Modal */}
      <PasswordDrawerModal
        visible={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        editItem={editingItem}
      />

      {/* Share Modal */}
      <ShareModal
        visible={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        item={shareItem}
      />
    </View>
  );
};

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
  orgSegmentBar: {
    flexDirection: 'row',
    marginHorizontal: 18,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    gap: 4,
  },
  orgSegmentTab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
  },
  orgSegmentTabActive: {
    backgroundColor: colors.cyanBg,
  },
  orgSegmentText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
  },
  orgSegmentTextActive: {
    color: colors.cyan,
    fontWeight: '700',
  },
  folderDropdownSheet: {
    marginHorizontal: 18,
    marginTop: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  folderDropdownOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  folderDropdownOptSelected: {
    backgroundColor: colors.cyanBg,
  },
  folderOptLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  folderOptLabel: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '400',
  },
  folderOptLabelActive: {
    color: colors.cyan,
    fontWeight: '600',
  },
  folderCount: {
    fontSize: 11.5,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  bulkBtnActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanBg,
  },
  bulkBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  batchActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
    marginHorizontal: 18,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  batchSubBtn: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  batchSubText: {
    fontSize: 12,
    color: colors.cyan,
    fontWeight: '600',
  },
  batchActionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  batchMoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.cyanBg,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
  },
  batchMoveText: {
    fontSize: 12,
    color: colors.cyan,
    fontWeight: '700',
  },
  batchDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
  },
  batchDeleteText: {
    fontSize: 12,
    color: colors.danger,
    fontWeight: '700',
  },
  sortHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sortHintText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  vaultList: {
    flex: 1,
    paddingHorizontal: 18,
  },
  vaultListContent: {
    paddingTop: 4,
    paddingBottom: 28,
    gap: 9,
  },
  centerLoading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  emptySubtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  moveModalOverlay: {
    flex: 1,
    backgroundColor: colors.overlayBg,
    justifyContent: 'flex-end',
  },
  moveModalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    maxHeight: '80%',
    paddingBottom: 28,
  },
  moveModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  moveModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  moveModalSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  moveCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveCloseText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  moveFolderList: {
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  moveFolderOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 11,
    padding: 12,
    marginBottom: 8,
  },
  moveFolderOptLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  folderIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveFolderOptName: {
    fontSize: 13.5,
    fontWeight: '600',
    color: colors.text,
  },
  moveFolderOptSub: {
    fontSize: 11.5,
    color: colors.textMuted,
    marginTop: 1,
  },
  addNewFolderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
    borderStyle: 'dashed',
    borderRadius: 11,
    paddingVertical: 12,
    marginTop: 4,
    marginBottom: 16,
  },
  addNewFolderText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.cyan,
  },
  newFolderBox: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 11,
    padding: 12,
    gap: 10,
    marginTop: 4,
    marginBottom: 16,
  },
  newFolderInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: colors.text,
  },
  newFolderActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  newFolderCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 7,
  },
  newFolderCancelText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  newFolderCreateBtn: {
    backgroundColor: colors.cyan,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 7,
  },
  newFolderCreateText: {
    fontSize: 12,
    color: '#062229',
    fontWeight: '700',
  },
});
