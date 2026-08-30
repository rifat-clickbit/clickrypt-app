import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { colors } from '../theme/colors';
import {
  LucideClock,
  LucideActivity,
  LucideShieldCheck,
  LucideShield,
  LucideKeyRound,
  LucideFolder,
  LucideUsers,
  LucideCamera,
  SearchIcon,
  CheckIcon,
  LucideTrash2,
  LucideCheckCheck,
} from './Icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import {
  ActivityLogItem,
  ActivityCategory,
  getActivityLogs,
  clearActivityLogs,
  markAllAsRead,
  subscribeToActivityLogs,
} from '../services/activityLogService';

interface ActivityLogModalProps {
  visible: boolean;
  onClose: () => void;
}

type FilterTab = 'all' | 'auth' | 'vault' | 'security' | 'share' | 'folder';

export const ActivityLogModal: React.FC<ActivityLogModalProps> = ({ visible, onClose }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<FilterTab>('all');
  const [loading, setLoading] = useState(false);

  const fetchLogs = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    const data = await getActivityLogs(user?.id, user?.email);
    setLogs(data);
    if (showLoading) setLoading(false);
  };

  useEffect(() => {
    if (visible) {
      fetchLogs(true);
      const unsubscribe = subscribeToActivityLogs(user?.id, () => {
        fetchLogs(false);
      });
      return () => {
        unsubscribe();
      };
    }
  }, [visible, user?.id, user?.email]);

  const handleMarkAllRead = async () => {
    await markAllAsRead(user?.id, user?.email);
    await fetchLogs();
  };

  const handleClearHistory = () => {
    Alert.alert(
      'Clear Activity Log',
      'Are you sure you want to clear your security activity log and notifications?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            await clearActivityLogs(user?.id, user?.email);
            setLogs([]);
          },
        },
      ]
    );
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((item) => {
      if (activeCategory !== 'all' && item.category !== activeCategory) {
        return false;
      }
      if (search.trim()) {
        const query = search.toLowerCase();
        return (
          (item.title || '').toLowerCase().includes(query) ||
          (item.message || '').toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [logs, activeCategory, search]);

  const unreadCount = useMemo(() => logs.filter((l) => !l.isRead).length, [logs]);

  const formatRelativeTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHour / 24);

      if (diffSec < 60) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHour < 24) return `${diffHour}h ago`;
      if (diffDay === 1) return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Recently';
    }
  };

  const getCategoryIcon = (category: ActivityCategory) => {
    switch (category) {
      case 'auth':
        return {
          icon: <LucideShieldCheck size={16} color={colors.cyan} strokeWidth={2} />,
          bg: colors.cyanBg,
          border: colors.cyanBorder,
        };
      case 'vault':
        return {
          icon: <LucideKeyRound size={16} color="#38BDF8" strokeWidth={2} />,
          bg: 'rgba(56, 189, 248, 0.12)',
          border: 'rgba(56, 189, 248, 0.3)',
        };
      case 'security':
        return {
          icon: <LucideShield size={16} color={colors.success} strokeWidth={2} />,
          bg: colors.successBg,
          border: 'rgba(52, 211, 153, 0.3)',
        };
      case 'share':
        return {
          icon: <LucideUsers size={16} color="#818CF8" strokeWidth={2} />,
          bg: 'rgba(129, 140, 248, 0.12)',
          border: 'rgba(129, 140, 248, 0.3)',
        };
      case 'folder':
        return {
          icon: <LucideFolder size={16} color={colors.warning} strokeWidth={2} />,
          bg: colors.warningBg,
          border: 'rgba(251, 191, 36, 0.3)',
        };
      case 'profile':
      default:
        return {
          icon: <LucideCamera size={16} color="#C084FC" strokeWidth={2} />,
          bg: 'rgba(192, 132, 252, 0.12)',
          border: 'rgba(192, 132, 252, 0.3)',
        };
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconBg}>
                <LucideActivity size={18} color={colors.cyan} strokeWidth={2.2} />
              </View>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.headerTitle}>Activity & Notifications</Text>
                  {unreadCount > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>{unreadCount} new</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.headerSubtitle}>Audit trail of in-app security actions</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Top Actions Row */}
          <View style={styles.actionRow}>
            {unreadCount > 0 && (
              <TouchableOpacity
                style={styles.markReadBtn}
                onPress={handleMarkAllRead}
                activeOpacity={0.7}
              >
                <LucideCheckCheck size={14} color={colors.cyan} />
                <Text style={styles.markReadText}>Mark all as read</Text>
              </TouchableOpacity>
            )}

            {logs.length > 0 && (
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={handleClearHistory}
                activeOpacity={0.7}
              >
                <LucideTrash2 size={13} color={colors.textMuted} />
                <Text style={styles.clearBtnText}>Clear Log</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Search Bar */}
          <View style={styles.searchBar}>
            <SearchIcon size={14} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search activities, keywords..."
              placeholderTextColor={colors.textMuted}
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Text style={styles.clearSearchText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Category Filter Pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterScroll}
            contentContainerStyle={styles.filterScrollContent}
          >
            {(
              [
                { id: 'all', label: 'All Activity' },
                { id: 'auth', label: 'Logins & Auth' },
                { id: 'vault', label: 'Vault & Keys' },
                { id: 'security', label: 'Security Scans' },
                { id: 'share', label: 'Team & Shares' },
                { id: 'folder', label: 'Folders' },
              ] as { id: FilterTab; label: string }[]
            ).map((tab) => {
              const active = activeCategory === tab.id;
              return (
                <TouchableOpacity
                  key={tab.id}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                  onPress={() => setActiveCategory(tab.id)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Activity Notifications List */}
          <ScrollView
            style={styles.logList}
            contentContainerStyle={styles.logListContent}
            showsVerticalScrollIndicator={false}
          >
            {filteredLogs.length === 0 ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconBg}>
                  <LucideClock size={32} color={colors.textMuted} />
                </View>
                <Text style={styles.emptyTitle}>No activity recorded</Text>
                <Text style={styles.emptySubtitle}>
                  {search
                    ? `No activity matching "${search}".`
                    : 'New security events and in-app actions will appear here.'}
                </Text>
              </View>
            ) : (
              filteredLogs.map((item) => {
                const iconConfig = getCategoryIcon(item.category);
                return (
                  <View
                    key={item.id}
                    style={[styles.logCard, !item.isRead && styles.logCardUnread]}
                  >
                    {/* Left Icon Badge */}
                    <View
                      style={[
                        styles.logIconWrapper,
                        { backgroundColor: iconConfig.bg, borderColor: iconConfig.border },
                      ]}
                    >
                      {iconConfig.icon}
                    </View>

                    {/* Content */}
                    <View style={styles.logBody}>
                      <View style={styles.logTitleRow}>
                        <Text style={styles.logTitle}>{item.title}</Text>
                        <View style={styles.logMetaRight}>
                          <Text style={styles.logTime}>{formatRelativeTime(item.timestamp)}</Text>
                          {!item.isRead && <View style={styles.unreadDot} />}
                        </View>
                      </View>

                      <Text style={styles.logMessage}>{item.message}</Text>

                      <View style={styles.logFooter}>
                        {item.mode && (
                          <View
                            style={[
                              styles.modeTag,
                              item.mode === 'organization' ? styles.orgTag : styles.personalTag,
                            ]}
                          >
                            <Text
                              style={item.mode === 'organization' ? styles.orgTagText : styles.personalTagText}
                            >
                              {item.mode === 'organization' ? 'Organization' : 'Personal'}
                            </Text>
                          </View>
                        )}
                      </View>
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
    maxHeight: '90%',
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
    backgroundColor: colors.cyanBg,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  unreadBadge: {
    backgroundColor: colors.cyan,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 8,
  },
  unreadBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#062229',
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
    paddingTop: 10,
    paddingBottom: 4,
  },
  markReadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: colors.cyanBg,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
  },
  markReadText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.cyan,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  clearBtnText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    marginHorizontal: 18,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  searchInput: {
    flex: 1,
    fontSize: 12.5,
    color: colors.text,
    padding: 0,
  },
  clearSearchText: {
    fontSize: 11,
    color: colors.cyan,
    fontWeight: '600',
  },
  filterScroll: {
    marginTop: 10,
    maxHeight: 36,
  },
  filterScrollContent: {
    paddingHorizontal: 18,
    gap: 8,
    alignItems: 'center',
  },
  filterPill: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  filterPillActive: {
    backgroundColor: colors.cyanBg,
    borderColor: colors.cyan,
  },
  filterPillText: {
    fontSize: 11.5,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  filterPillTextActive: {
    color: colors.cyan,
    fontWeight: '700',
  },
  logList: {
    marginTop: 12,
    paddingHorizontal: 18,
    maxHeight: 440,
  },
  logListContent: {
    gap: 8,
    paddingBottom: 20,
  },
  logCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  logCardUnread: {
    borderColor: colors.cyanBorder,
    backgroundColor: 'rgba(34, 211, 238, 0.04)',
  },
  logIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  logBody: {
    flex: 1,
    gap: 3,
  },
  logTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  logMetaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logTime: {
    fontSize: 10.5,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.cyan,
  },
  logMessage: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  logFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  modeTag: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  orgTag: {
    backgroundColor: colors.cyanBg,
  },
  orgTagText: {
    fontSize: 9.5,
    fontWeight: '600',
    color: colors.cyan,
  },
  personalTag: {
    backgroundColor: colors.warningBg,
  },
  personalTagText: {
    fontSize: 9.5,
    fontWeight: '600',
    color: colors.warning,
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
