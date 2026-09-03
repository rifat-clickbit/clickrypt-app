import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { colors } from '../theme/colors';
import { Header } from '../components/Header';
import { PasswordCard } from '../components/PasswordCard';
import { PasswordDrawerModal } from '../components/PasswordDrawerModal';
import { ShareModal } from '../components/ShareModal';
import { useVault } from '../context/VaultContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabaseClient';
import { FolderItem, VaultItem } from '../types';
import {
  LucideFolder,
  LucideFolderOpen,
  LucideArrowLeft,
  LucidePlus,
  ChevronRightIcon,
  LucideTrash2,
} from '../components/Icons';
import { useTheme } from '../theme/ThemeContext';

export const FoldersScreen = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { folders, items, deleteItem, refreshVault } = useVault();
  const { user, appMode } = useAuth();

  // Selected folder for drill-down view
  const [selectedFolder, setSelectedFolder] = useState<FolderItem | null>(null);

  // New folder modal
  const [modalVisible, setModalVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Password creation & sharing modals inside folder view
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareItem, setShareItem] = useState<VaultItem | null>(null);

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    if (!user) return;
    const newFolder: FolderItem = {
      id: `fld-${Date.now()}`,
      name: newFolderName.trim(),
      itemCount: 0,
      lastModified: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      mode: appMode,
      color: '#FBBF24',
    };

    await supabase.from('folders').upsert({
      id: newFolder.id,
      name: newFolder.name,
      description: newFolder.description || 'Custom folder',
      color: newFolder.color || '#FBBF24',
      mode: appMode,
      owner_id: user.id,
      organization_id: user.organizationId || null,
      data: newFolder,
    });

    setNewFolderName('');
    setModalVisible(false);
    await refreshVault();
  };

  const handleDeleteFolder = (folder: FolderItem) => {
    Alert.alert(
      'Delete Folder',
      `Are you sure you want to delete the folder "${folder.name}"? Passwords inside will remain safe in your vault.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Folder',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('folders').delete().eq('id', folder.id);
            if (selectedFolder?.id === folder.id) {
              setSelectedFolder(null);
            }
            await refreshVault();
          },
        },
      ]
    );
  };

  const handleEditItem = (item: VaultItem) => {
    setEditingItem(item);
    setIsDrawerOpen(true);
  };

  const handleShareItem = (item: VaultItem) => {
    setShareItem(item);
    setIsShareModalOpen(true);
  };

  // If a folder is clicked, render its drill-down password contents
  if (selectedFolder) {
    const folderPasswords = items.filter((i) => i.folderId === selectedFolder.id && !i.isDeleted);

    return (
      <View style={styles.container}>
        {/* Custom Folder View Header */}
        <View style={styles.drillHeader}>
          <TouchableOpacity
            style={styles.backBtn}
            activeOpacity={0.7}
            onPress={() => setSelectedFolder(null)}
          >
            <LucideArrowLeft size={16} color={colors.cyan} strokeWidth={2.5} />
            <Text style={styles.backBtnText}>Folders</Text>
          </TouchableOpacity>

          <View style={styles.folderTitleRow}>
            <View style={styles.folderTitleLeft}>
              <LucideFolderOpen size={20} color={colors.warning} />
              <Text style={styles.drillTitle} numberOfLines={1}>
                {selectedFolder.name}
              </Text>
              <View style={styles.countPill}>
                <Text style={styles.countText}>{folderPasswords.length} items</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.deleteFolderIconBtn}
              onPress={() => handleDeleteFolder(selectedFolder)}
            >
              <LucideTrash2 size={16} color={colors.danger} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Add Password to this folder action banner */}
        <TouchableOpacity
          style={styles.addPasswordBanner}
          activeOpacity={0.8}
          onPress={() => {
            setEditingItem(null);
            setIsDrawerOpen(true);
          }}
        >
          <LucidePlus size={16} color="#062229" strokeWidth={2.5} />
          <Text style={styles.addPasswordBannerText}>Add Password to this Folder</Text>
        </TouchableOpacity>

        {/* List of passwords in this folder */}
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {folderPasswords.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconBg}>
                <LucideFolder size={28} color={colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>This folder is empty</Text>
              <Text style={styles.emptySubtitle}>
                Tap the button above to add and organize credentials in "{selectedFolder.name}".
              </Text>
            </View>
          ) : (
            folderPasswords.map((item, index) => (
              <PasswordCard
                key={item.id}
                item={item}
                initialExpanded={index === 0}
                onEdit={handleEditItem}
                onShare={handleShareItem}
                onDelete={deleteItem}
              />
            ))
          )}
        </ScrollView>

        {/* Password Add/Edit Drawer */}
        <PasswordDrawerModal
          visible={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          editItem={editingItem}
          defaultFolderId={selectedFolder.id}
        />

        {/* Share Modal */}
        <ShareModal
          visible={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          item={shareItem}
        />
      </View>
    );
  }

  // Root Folders Directory View
  return (
    <View style={styles.container}>
      <Header
        title="Folders"
        itemCount={folders.length}
        onAddPress={() => setModalVisible(true)}
      />

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {folders.map((folder) => {
          const count = items.filter((i) => i.folderId === folder.id && !i.isDeleted).length;
          return (
            <TouchableOpacity
              key={folder.id}
              style={styles.folderRow}
              activeOpacity={0.7}
              onPress={() => setSelectedFolder(folder)}
            >
              <View style={styles.folderLeft}>
                <View style={styles.folderIconBg}>
                  <LucideFolder size={18} color={colors.warning} />
                </View>
                <View>
                  <Text style={styles.folderName}>{folder.name}</Text>
                  <Text style={styles.folderModified}>Modified {folder.lastModified}</Text>
                </View>
              </View>

              <View style={styles.folderRight}>
                <View style={styles.countPill}>
                  <Text style={styles.countText}>{count} items</Text>
                </View>
                <ChevronRightIcon size={14} color={colors.textMuted} />
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* New Folder Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create New Folder</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Work & Cloud Services"
              placeholderTextColor={colors.textMuted}
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCreateBtn}
                onPress={handleCreateFolder}
              >
                <Text style={styles.modalCreateText}>Create</Text>
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
  drillHeader: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
    gap: 8,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  backBtnText: {
    color: colors.cyan,
    fontSize: 13,
    fontWeight: '600',
  },
  folderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  folderTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  drillTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  deleteFolderIconBtn: {
    padding: 6,
  },
  addPasswordBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.cyan,
    marginHorizontal: 18,
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 10,
    borderRadius: 10,
  },
  addPasswordBannerText: {
    color: '#062229',
    fontSize: 13,
    fontWeight: '700',
  },
  list: {
    flex: 1,
    paddingHorizontal: 18,
  },
  listContent: {
    paddingTop: 10,
    paddingBottom: 24,
    gap: 9,
  },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 13,
  },
  folderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  folderIconBg: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.warningBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  folderModified: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  folderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countPill: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  countText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyIconBg: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  emptySubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 24,
    lineHeight: 17,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 12, 0.75)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 16,
    padding: 20,
    gap: 14,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  modalInput: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 13.5,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  modalCreateBtn: {
    backgroundColor: colors.cyan,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalCreateText: {
    color: '#062229',
    fontSize: 13,
    fontWeight: '700',
  },
});
