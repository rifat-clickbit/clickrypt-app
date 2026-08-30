import React, { useState, useMemo, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
} from 'react-native';
import { colors } from '../theme/colors';
import {
  BackIcon,
  BellIcon,
  SearchIcon,
  PlusIcon,
  FilterIcon,
  FolderIcon,
  ChevronDownIcon,
  CheckIcon,
} from './Icons';
import { useAuth } from '../context/AuthContext';
import { useVault, FilterMode } from '../context/VaultContext';
import { useTheme } from '../theme/ThemeContext';
import { EditProfileModal } from './EditProfileModal';
import { FilterSheet } from './FilterSheet';
import { ActivityLogModal } from './ActivityLogModal';
import { getUnreadCount, subscribeToActivityLogs } from '../services/activityLogService';

interface HeaderProps {
  title?: string;
  itemCount?: number;
  onAddPress?: () => void;
  onBackPress?: () => void;
}

const FILTER_LABELS: Record<FilterMode, string> = {
  all: 'All Vault',
  notes: 'Secure Notes',
  leaked: 'Leaked',
  outdated: 'Outdated',
  own: 'My passwords',
  sharedWithMe: 'Shared with me',
  sharedByMe: 'Shared by me',
  lastModified: 'Last modified',
  trash: 'Trash / Recycle Bin',
};

export const Header: React.FC<HeaderProps> = ({
  title = 'Passwords',
  itemCount = 1,
  onAddPress,
  onBackPress,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, appMode } = useAuth();
  const {
    items,
    folders,
    searchQuery,
    setSearchQuery,
    filterMode,
    setFilterMode,
    selectedFolderId,
    setSelectedFolderId,
    activeTab,
    setActiveTab,
    isFilterOpen,
    setIsFilterOpen,
    isFolderDropdownOpen,
    setIsFolderDropdownOpen,
  } = useVault();

  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const checkUnread = async () => {
    const count = await getUnreadCount(user?.id, user?.email);
    setUnreadCount(count);
  };

  useEffect(() => {
    checkUnread();
    const unsubscribe = subscribeToActivityLogs(user?.id, () => {
      checkUnread();
    });
    return () => {
      unsubscribe();
    };
  }, [user?.id, user?.email, items.length]);

  const userInitials = user?.name
    ? user.name
        .split(' ')
        .filter(Boolean)
        .map((p) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'RE';

  // Compute live filter counts for FilterSheet
  const filterCounts = useMemo(() => {
    const activeItems = items.filter((i) => !i.isDeleted);
    return {
      all: activeItems.length,
      notes: activeItems.filter((i) => i.itemType === 'note').length,
      sharedWithMe: activeItems.filter(
        (i) =>
          appMode === 'organization' &&
          i.ownerId !== user?.id &&
          (i.sharedWith?.includes(user?.id || '') || i.isExternalShared)
      ).length,
      sharedByMe: activeItems.filter(
        (i) =>
          i.ownerId === user?.id &&
          ((i.sharedWith && i.sharedWith.length > 0) || i.isExternalShared)
      ).length,
      own: activeItems.filter((i) => i.ownerId === user?.id).length,
      leaked: activeItems.filter((i) => i.isLeaked).length,
      outdated: activeItems.filter((i) => i.isOld).length,
      lastModified: activeItems.length,
      trash: items.filter((i) => i.isDeleted).length,
    };
  }, [items, user?.id, appMode]);

  // Selected folder display name
  const selectedFolderName = useMemo(() => {
    if (!selectedFolderId) return 'All Folders';
    const match = folders.find((f) => f.id === selectedFolderId);
    return match ? match.name : 'All Folders';
  }, [folders, selectedFolderId]);

  const handleBack = () => {
    if (onBackPress) {
      onBackPress();
      return;
    }
    // If not on Passwords tab, go back to Passwords
    if (activeTab !== 'passwords') {
      setActiveTab('passwords');
      return;
    }
    // If on passwords, clear search and reset filter
    if (searchQuery) setSearchQuery('');
    setIsFilterOpen(false);
    setIsFolderDropdownOpen(false);
  };

  const handleToggleFilterSheet = () => {
    setIsFolderDropdownOpen(false);
    setIsFilterOpen((prev) => !prev);
  };

  const handleToggleFolderSheet = () => {
    setIsFilterOpen(false);
    setIsFolderDropdownOpen((prev) => !prev);
  };

  const handleSelectFilter = (mode: FilterMode) => {
    setFilterMode(mode);
    setIsFilterOpen(false);
    if (activeTab !== 'passwords') {
      setActiveTab('passwords');
    }
  };

  const handleSelectFolder = (folderId: string | null) => {
    setSelectedFolderId(folderId);
    setIsFolderDropdownOpen(false);
    if (activeTab !== 'passwords') {
      setActiveTab('passwords');
    }
  };

  return (
    <View style={styles.container}>
      {/* Top row with back button, bell notification, avatar */}
      <View style={styles.headerTop}>
        <TouchableOpacity
          style={styles.backBtn}
          activeOpacity={0.7}
          onPress={handleBack}
        >
          <BackIcon size={15} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.headerIcons}>
          <TouchableOpacity
            style={styles.iconBtn}
            activeOpacity={0.7}
            onPress={() => setIsActivityModalOpen(true)}
          >
            <BellIcon size={15} color={colors.textSecondary} />
            {unreadCount > 0 && <View style={styles.dotBadge} />}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.avatarBtn}
            activeOpacity={0.7}
            onPress={() => setIsProfileModalOpen(true)}
          >
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatarBtnImage} />
            ) : (
              <Text style={styles.avatarText}>{userInitials}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Edit Profile Modal */}
      <EditProfileModal
        visible={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />

      {/* Activity & Security Notifications Modal */}
      <ActivityLogModal
        visible={isActivityModalOpen}
        onClose={() => {
          setIsActivityModalOpen(false);
          checkUnread();
        }}
      />

      {/* Search Input Bar */}
      <View style={styles.searchBar}>
        <SearchIcon size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search passwords, tags..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
        />
        <View style={styles.kbd}>
          <Text style={styles.kbdText}>⌘K</Text>
        </View>
      </View>

      {/* Title & Count Row */}
      <View style={styles.titleRow}>
        <View style={styles.titleLeft}>
          <Text style={styles.pageTitle}>{title}</Text>
          <View style={styles.countPill}>
            <Text style={styles.countText}>
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </Text>
          </View>
        </View>

        {onAddPress && (
          <TouchableOpacity style={styles.addBtn} activeOpacity={0.8} onPress={onAddPress}>
            <PlusIcon size={14} color="#062229" strokeWidth={2.4} />
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Universal Filter & Folder Selection Row */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterSelect, isFilterOpen && styles.filterSelectActive]}
          activeOpacity={0.7}
          onPress={handleToggleFilterSheet}
        >
          <View style={styles.filterLeft}>
            <FilterIcon size={14} color={colors.cyan} />
            <Text style={styles.filterText} numberOfLines={1}>
              {FILTER_LABELS[filterMode]}
            </Text>
          </View>
          <ChevronDownIcon size={13} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.folderSelect, isFolderDropdownOpen && styles.filterSelectActive]}
          activeOpacity={0.7}
          onPress={handleToggleFolderSheet}
        >
          <View style={styles.filterLeft}>
            <FolderIcon size={14} color={colors.warning} />
            <Text style={styles.filterText} numberOfLines={1}>
              {selectedFolderName}
            </Text>
          </View>
          <ChevronDownIcon size={13} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Dropdown Sheets (Interactive on all screens) */}
      {isFilterOpen && (
        <FilterSheet
          currentFilter={filterMode}
          onSelect={handleSelectFilter}
          counts={filterCounts}
          appMode={appMode}
        />
      )}

      {isFolderDropdownOpen && (
        <View style={styles.folderDropdownSheet}>
          <TouchableOpacity
            style={[
              styles.folderDropdownOpt,
              !selectedFolderId && styles.folderDropdownOptSelected,
            ]}
            onPress={() => handleSelectFolder(null)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <FolderIcon size={13} color={colors.warning} />
              <Text
                style={[
                  styles.folderDropdownText,
                  !selectedFolderId && styles.folderDropdownTextSelected,
                ]}
              >
                All Folders
              </Text>
            </View>
            {!selectedFolderId && <CheckIcon size={13} color={colors.cyan} strokeWidth={2.5} />}
          </TouchableOpacity>

          {folders.map((f) => {
            const isSelected = selectedFolderId === f.id;
            const count = items.filter((i) => i.folderId === f.id).length;
            return (
              <TouchableOpacity
                key={f.id}
                style={[styles.folderDropdownOpt, isSelected && styles.folderDropdownOptSelected]}
                onPress={() => handleSelectFolder(f.id)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <FolderIcon size={13} color={colors.warning} />
                  <Text
                    style={[
                      styles.folderDropdownText,
                      isSelected && styles.folderDropdownTextSelected,
                    ]}
                  >
                    {f.name}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.folderCount}>{count}</Text>
                  {isSelected && <CheckIcon size={13} color={colors.cyan} strokeWidth={2.5} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
};

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 18,
      paddingTop: 8,
      paddingBottom: 4,
    },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  dotBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.cyan,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  avatarBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#22304A',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarBtnImage: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  avatarText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.cyan,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 9,
    marginBottom: 14,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13.5,
    padding: 0,
  },
  kbd: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  kbdText: {
    fontSize: 10,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  titleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  pageTitle: {
    fontSize: 21,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  countPill: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countText: {
    fontSize: 11,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.cyan,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 8,
  },
  addBtnText: {
    color: '#062229',
    fontSize: 12.5,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterSelect: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  filterSelectActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanBg,
  },
  folderSelect: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  filterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  filterText: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '500',
  },
  folderDropdownSheet: {
    marginTop: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  folderDropdownOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  folderDropdownOptSelected: {
    backgroundColor: colors.cyanBg,
  },
  folderDropdownText: {
    fontSize: 12.5,
    color: colors.text,
  },
  folderDropdownTextSelected: {
    color: colors.cyan,
    fontWeight: '600',
  },
  folderCount: {
    fontSize: 11,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
});
