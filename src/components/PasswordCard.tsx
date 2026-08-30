import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Linking, Alert, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { colors } from '../theme/colors';
import {
  DragDotsIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  CopyIcon,
  ShareIcon,
  EditIcon,
  TrashIcon,
  AlertWarningIcon,
  CheckIcon,
  LucideFileText,
  LucideRotateCcw,
  LucideTrash2,
  LucideInbox as Inbox,
  LucideSend as Send,
  LucideShare2 as Share2,
} from './Icons';
import { VaultItem } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UnlockVaultModal } from './UnlockVaultModal';
import { useVault } from '../context/VaultContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import {
  generateTOTPCode,
  decryptSecret,
  isEncryptedCipher,
} from '../crypto/cryptoEngine';

interface PasswordCardProps {
  item: VaultItem;
  onEdit: (item: VaultItem) => void;
  onShare: (item: VaultItem) => void;
  onDelete: (id: string) => void;
  initialExpanded?: boolean;
  isBulkMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export const PasswordCard: React.FC<PasswordCardProps> = ({
  item,
  onEdit,
  onShare,
  onDelete,
  initialExpanded = false,
  isBulkMode = false,
  isSelected = false,
  onToggleSelect,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, appMode, unlockVault, unlockedPgpKey, masterPassword } = useAuth();
  const { revealPassword, refreshVault, revokeSharing, restoreItem, purgeItem } = useVault();
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [decryptedText, setDecryptedText] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [isNoteCopied, setIsNoteCopied] = useState(false);
  const [isTotpCopied, setIsTotpCopied] = useState(false);
  const [totpData, setTotpData] = useState({ code: '849 201', secondsRemaining: 30 });

  const isNote = item.itemType === 'note';
  const safeName = item.name || (item as any).title || (item as any).label || 'Untitled';
  const safeUsername = item.username || (item as any).user || (item as any).email || '—';
  const safeUrl = item.url || (item as any).website || '—';

  useEffect(() => {
    if (isNote) return;
    const interval = setInterval(() => {
      const totp = generateTOTPCode(safeName);
      setTotpData(totp);
    }, 1000);
    return () => clearInterval(interval);
  }, [safeName, isNote]);

  // Generate 2-character avatar initials
  const initials = safeName
    .slice(0, 2)
    .toUpperCase();

  const isAltColor = safeName.toLowerCase().startsWith('f') && safeName.length > 5;
  const avatarBg = isNote ? colors.cyanBg : isAltColor ? colors.warningBg : colors.cyanBg;
  const avatarColor = isNote ? colors.cyan : isAltColor ? colors.warning : colors.cyan;

  const handleToggleReveal = async () => {
    if (isRevealed) {
      setIsRevealed(false);
      return;
    }

    if (item.decryptedPassword && !isEncryptedCipher(item.decryptedPassword)) {
      setDecryptedText(item.decryptedPassword);
      setIsRevealed(true);
      return;
    }

    const activeKey = unlockedPgpKey || (await AsyncStorage.getItem('clickrypt_unlocked_pgp_key'));
    const activePass = masterPassword || (await AsyncStorage.getItem('clickrypt_master_password'));

    if (!activeKey && !activePass) {
      setShowUnlockModal(true);
      return;
    }

    setIsRevealing(true);
    try {
      const secret = await revealPassword(item);
      if (secret && !isEncryptedCipher(secret)) {
        setDecryptedText(secret);
      }
    } catch {
      // ignore
    } finally {
      setIsRevealing(false);
      setIsRevealed(true);
    }
  };

  const handleUnlockSubmit = async (pass: string) => {
    const ok = await unlockVault(pass);
    if (ok) {
      setShowUnlockModal(false);
      setIsRevealing(true);
      try {
        const secret = await revealPassword(item);
        if (secret && !isEncryptedCipher(secret)) {
          setDecryptedText(secret);
        }
      } catch {
        // ignore
      } finally {
        setIsRevealing(false);
        setIsRevealed(true);
      }
      refreshVault().catch(() => {});
      return true;
    }
    return false;
  };

  const handleCopy = async () => {
    const secret = decryptedText || item.decryptedPassword || item.noteContent || (await revealPassword(item));
    if (secret) {
      await Clipboard.setStringAsync(secret);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const handleCopyAttachedNote = async () => {
    if (!item.noteContent) return;
    await Clipboard.setStringAsync(item.noteContent);
    setIsNoteCopied(true);
    setTimeout(() => setIsNoteCopied(false), 2000);
  };

  const handleCopyTotp = async () => {
    await Clipboard.setStringAsync(totpData.code.replace(/\s+/g, ''));
    setIsTotpCopied(true);
    setTimeout(() => setIsTotpCopied(false), 2000);
  };

  const handleOpenUrl = () => {
    if (!item.url || isNote) return;
    const targetUrl = item.url.startsWith('http') ? item.url : `https://${item.url}`;
    Linking.openURL(targetUrl).catch(() => {});
  };

  const handleDeletePress = () => {
    Alert.alert('Move to Trash', `Move "${item.name}" to Trash / Recycle Bin?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move to Trash', style: 'destructive', onPress: () => onDelete(item.id) },
    ]);
  };

  const handleRestore = async () => {
    await restoreItem(item.id);
    Alert.alert('Restored', `"${item.name}" has been restored to your active vault.`);
  };

  const handlePurge = () => {
    Alert.alert('Delete Forever', `Permanently delete "${item.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Forever', style: 'destructive', onPress: () => purgeItem(item.id) },
    ]);
  };

  const isSharedWithMe =
    appMode === 'organization' &&
    item.ownerId !== user?.id &&
    (item.sharedWith?.includes(user?.id || '') || item.isExternalShared);
  const isSharedByMe =
    item.ownerId === user?.id &&
    ((item.sharedWith && item.sharedWith.length > 0) || item.isExternalShared);

  return (
    <View style={[styles.card, isSelected && styles.cardSelected, item.isDeleted && styles.cardDeleted]}>
      {/* Top Header Row */}
      <TouchableOpacity
        style={styles.rowTop}
        activeOpacity={0.7}
        onPress={() => {
          if (isBulkMode && onToggleSelect) {
            onToggleSelect(item.id);
          } else {
            setIsExpanded(!isExpanded);
          }
        }}
      >
        {isBulkMode ? (
          <TouchableOpacity
            style={[styles.checkbox, isSelected && styles.checkboxSelected]}
            onPress={() => onToggleSelect && onToggleSelect(item.id)}
          >
            {isSelected && <CheckIcon size={12} color="#062229" />}
          </TouchableOpacity>
        ) : (
          <View style={styles.dragDots}>
            <DragDotsIcon size={11} color={colors.textMuted} />
          </View>
        )}

        <View style={[styles.siteIcon, { backgroundColor: avatarBg }]}>
          {isNote ? (
            <LucideFileText size={16} color={avatarColor} />
          ) : (
            <Text style={[styles.siteIconText, { color: avatarColor }]}>{initials}</Text>
          )}
        </View>

        <View style={styles.rowInfo}>
          <Text style={styles.rowName} numberOfLines={1}>
            {safeName}
          </Text>
          <Text style={styles.rowUser} numberOfLines={1}>
            {isNote
              ? `Secure Note · ${item.lastModified || 'Confidential'}`
              : `${safeUsername !== '—' ? safeUsername : 'user'} · ${safeUrl !== '—' ? safeUrl : 'clickrypt.com'}`}
          </Text>
        </View>

        <View style={styles.expandToggle}>
          {isExpanded ? (
            <ChevronDownIcon size={14} color={colors.textMuted} />
          ) : (
            <ChevronRightIcon size={14} color={colors.textMuted} />
          )}
        </View>
      </TouchableOpacity>

      {!isExpanded && (item.isOld || isSharedWithMe || isSharedByMe || item.isLeaked || isNote || item.isDeleted) && (
        <View style={styles.badgeRow}>
          {item.isDeleted && (
            <View style={[styles.secBadge, styles.badgeLeaked]}>
              <LucideTrash2 size={9} color={colors.danger} />
              <Text style={[styles.badgeText, { color: colors.danger }]}>In Trash</Text>
            </View>
          )}
          {isNote && (
            <View style={[styles.secBadge, styles.badgeNote]}>
              <LucideFileText size={9} color={colors.cyan} />
              <Text style={[styles.badgeText, { color: colors.cyan }]}>Encrypted Note</Text>
            </View>
          )}
          {item.isLeaked && !item.isDeleted && (
            <View style={[styles.secBadge, styles.badgeLeaked]}>
              <AlertWarningIcon size={9} color={colors.danger} />
              <Text style={[styles.badgeText, { color: colors.danger }]}>Leaked</Text>
            </View>
          )}
          {item.isOld && !item.isDeleted && (
            <View style={[styles.secBadge, styles.badgeOutdated]}>
              <AlertWarningIcon size={9} color={colors.warning} />
              <Text style={[styles.badgeText, { color: colors.warning }]}>Outdated</Text>
            </View>
          )}
          {isSharedWithMe && (
            <View style={[styles.secBadge, styles.badgeShared]}>
              <Inbox size={10} color={colors.cyan} />
              <Text style={[styles.badgeText, { color: colors.cyan }]}>Shared with me</Text>
            </View>
          )}
          {isSharedByMe && (
            <View style={[styles.secBadge, styles.badgeSharedByMe]}>
              <Send size={10} color={colors.success} />
              <Text style={[styles.badgeText, { color: colors.success }]}>
                Shared by me ({item.sharedWith?.length || 1})
              </Text>
            </View>
          )}
        </View>
      )}

      {isExpanded && (
        <View style={styles.rowDetail}>
          {/* SECURE NOTE VIEW */}
          {isNote ? (
            <View style={styles.noteContentContainer}>
              <View style={styles.noteHeader}>
                <Text style={styles.detailLabel}>Secure Note Body</Text>
                <TouchableOpacity onPress={handleCopy} style={styles.miniCopyBtn}>
                  <CopyIcon size={12} color={isCopied ? colors.success : colors.cyan} />
                  <Text style={[styles.miniCopyText, isCopied && { color: colors.success }]}>
                    {isCopied ? 'Copied' : 'Copy'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.noteBox}>
                <Text style={styles.noteText} numberOfLines={isRevealed ? undefined : 4}>
                  {isRevealed
                    ? decryptedText || item.noteContent || 'Empty note content'
                    : '••••••••••••••••••••••••••••••••••••••••\n••••••••••••••••••••••••••••••••••••••••\n••••••••••••••••••••••••••••••••••••••••'}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.revealNoteBtn}
                onPress={handleToggleReveal}
                activeOpacity={0.7}
              >
                {isRevealing ? (
                  <ActivityIndicator size="small" color={colors.cyan} style={{ marginRight: 4 }} />
                ) : (
                  <EyeIcon size={13} color={colors.cyan} />
                )}
                <Text style={styles.revealNoteText}>
                  {isRevealed ? 'Hide Secret Note' : 'Reveal Secret Note'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.detailLine}>
                <Text style={styles.detailLabel}>Username</Text>
                <Text style={styles.detailVal}>{safeUsername}</Text>
              </View>

              {/* URL */}
              <View style={styles.detailLine}>
                <Text style={styles.detailLabel}>URL</Text>
                <TouchableOpacity onPress={handleOpenUrl} activeOpacity={0.7}>
                  <Text style={[styles.detailVal, styles.detailValLink]}>{safeUrl}</Text>
                </TouchableOpacity>
              </View>

              {/* Password with Reveal & Copy */}
              <View style={styles.detailLine}>
                <Text style={styles.detailLabel}>Password</Text>
                <View style={styles.passVal}>
                  {isRevealing ? (
                    <ActivityIndicator size="small" color={colors.cyan} style={{ marginRight: 6 }} />
                  ) : (
                    <Text
                      style={[
                        styles.secretValue,
                        isRevealed && { color: colors.cyan, letterSpacing: 0.5 },
                      ]}
                      numberOfLines={1}
                    >
                      {isRevealed
                        ? decryptedText || item.decryptedPassword || '(empty password)'
                        : '••••••••'}
                    </Text>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.miniIconBtn,
                      isRevealed && { backgroundColor: colors.cyanBg, borderColor: colors.cyanBorder },
                    ]}
                    activeOpacity={0.7}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    onPress={handleToggleReveal}
                  >
                    <EyeIcon size={13} color={isRevealed ? colors.cyan : colors.textSecondary} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.miniIconBtn,
                      isCopied && { backgroundColor: colors.successBg, borderColor: colors.cyanBorder },
                    ]}
                    activeOpacity={0.7}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    onPress={handleCopy}
                  >
                    <CopyIcon size={12} color={isCopied ? colors.success : colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Attached Secure Note (if item has noteContent) */}
              {!!item.noteContent && (
                <View style={styles.noteContentContainer}>
                  <View style={styles.noteHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <LucideFileText size={12} color={colors.cyan} />
                      <Text style={styles.detailLabel}>Secure Note</Text>
                    </View>
                    <TouchableOpacity onPress={handleCopyAttachedNote} style={styles.miniCopyBtn}>
                      <CopyIcon size={11} color={isNoteCopied ? colors.success : colors.cyan} />
                      <Text style={[styles.miniCopyText, isNoteCopied && { color: colors.success }]}>
                        {isNoteCopied ? 'Copied' : 'Copy Note'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.noteBox}>
                    <Text style={styles.noteText}>
                      {item.noteContent}
                    </Text>
                  </View>
                </View>
              )}
            </>
          )}

          {/* Last Modified */}
          <View style={styles.detailLine}>
            <Text style={styles.detailLabel}>Last modified</Text>
            <Text style={styles.detailVal}>{item.lastModified}</Text>
          </View>

          {/* Dedicated Sharing Metadata Section */}
          {isSharedWithMe && (
            <View style={styles.sharedInfoBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Inbox size={13} color={colors.cyan} />
                <Text style={styles.sharedInfoTitle}>Shared with you</Text>
              </View>
              <Text style={styles.sharedInfoText}>
                Provided by{' '}
                <Text style={{ color: colors.cyan, fontWeight: '600' }}>
                  {item.ownerName || item.ownerEmail || 'Organization Colleague'}
                </Text>
              </Text>
            </View>
          )}

          {isSharedByMe && (
            <View style={styles.sharedInfoBox}>
              <View style={styles.sharedInfoHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Send size={13} color={colors.success} />
                  <Text style={styles.sharedInfoTitle}>Shared with Team Members</Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    Alert.alert(
                      'Revoke Sharing',
                      `Revoke sharing access for "${item.name}"? Colleagues will no longer see this password in their vault.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Revoke Access',
                          style: 'destructive',
                          onPress: () => revokeSharing(item.id),
                        },
                      ]
                    );
                  }}
                >
                  <Text style={styles.revokeText}>Revoke Access</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.recipientPillRow}>
                {item.sharedWithMembers && item.sharedWithMembers.length > 0 ? (
                  item.sharedWithMembers.map((m) => (
                    <View key={m.id} style={styles.recipientPill}>
                      <Text style={styles.recipientPillText}>{m.name || m.email}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.sharedInfoText}>Active with organization members</Text>
                )}
              </View>
            </View>
          )}

          {/* Action Buttons */}
          {item.isDeleted ? (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionRestore]}
                activeOpacity={0.8}
                onPress={handleRestore}
              >
                <LucideRotateCcw size={12} color={colors.cyan} />
                <Text style={[styles.actionBtnText, { color: colors.cyan }]}>Restore</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.actionDelete]}
                activeOpacity={0.8}
                onPress={handlePurge}
              >
                <LucideTrash2 size={12} color={colors.danger} />
                <Text style={[styles.actionBtnText, { color: colors.danger }]}>Delete Forever</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionShare]}
                activeOpacity={0.8}
                onPress={() => onShare(item)}
              >
                <Share2 size={12} color={colors.cyan} />
                <Text style={[styles.actionBtnText, { color: colors.cyan }]}>Share</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.actionEdit]}
                activeOpacity={0.8}
                onPress={() => onEdit(item)}
              >
                <EditIcon size={12} color={colors.warning} />
                <Text style={[styles.actionBtnText, { color: colors.warning }]}>Edit</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.actionDelete]}
                activeOpacity={0.8}
                onPress={handleDeletePress}
              >
                <TrashIcon size={12} color={colors.danger} />
                <Text style={[styles.actionBtnText, { color: colors.danger }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <UnlockVaultModal
        isOpen={showUnlockModal}
        onClose={() => setShowUnlockModal(false)}
        onSubmit={handleUnlockSubmit}
        title="Unlock Vault"
        description="Enter your master password to decrypt and view credentials."
      />
    </View>
  );
};

const createStyles = (colors: any) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 13,
      padding: 12,
    },
  cardSelected: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanBg,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  dragDots: {
    opacity: 0.5,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  siteIcon: {
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  siteIconText: {
    fontSize: 13,
    fontWeight: '700',
  },
  rowInfo: {
    flex: 1,
  },
  rowName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  rowUser: {
    fontSize: 11.5,
    color: colors.textMuted,
    marginTop: 1,
  },
  expandToggle: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    paddingLeft: 22,
  },
  secBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 20,
  },
  badgeOutdated: {
    backgroundColor: colors.warningBg,
  },
  badgeLeaked: {
    backgroundColor: colors.dangerBg,
  },
  badgeShared: {
    backgroundColor: colors.cyanBg,
  },
  badgeSharedByMe: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '500',
  },
  rowDetail: {
    marginTop: 11,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  detailLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailLabel: {
    fontSize: 10.5,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.textMuted,
    fontWeight: '600',
  },
  detailVal: {
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  detailValLink: {
    color: colors.cyan,
  },
  passVal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '75%',
  },
  secretValue: {
    fontSize: 13,
    letterSpacing: 1,
    color: colors.text,
    fontFamily: 'monospace',
    flexShrink: 1,
  },
  totpBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
    marginVertical: 2,
  },
  totpLeft: {
    gap: 2,
  },
  totpLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.cyan,
    letterSpacing: 0.5,
  },
  totpCode: {
    fontSize: 15,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 1.5,
  },
  totpRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  totpTimerBadge: {
    backgroundColor: colors.cyanBg,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 12,
  },
  totpTimerText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.cyan,
  },
  miniIconBtn: {
    minWidth: 28,
    minHeight: 28,
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionShare: {
    backgroundColor: colors.cyanBg,
    borderColor: colors.cyanBorder,
  },
  actionEdit: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warningBorder,
  },
  actionDelete: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerBorder,
  },
  actionBtnText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  sharedInfoBox: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    padding: 10,
    gap: 6,
  },
  sharedInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sharedInfoTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sharedInfoText: {
    fontSize: 11.5,
    color: colors.textSecondary,
  },
  revokeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.danger,
  },
  actionRestore: {
    backgroundColor: colors.cyanBg,
    borderColor: colors.cyanBorder,
  },
  cardDeleted: {
    borderColor: colors.dangerBorder,
    backgroundColor: 'rgba(248, 113, 113, 0.04)',
  },
  badgeNote: {
    backgroundColor: colors.cyanBg,
    borderColor: colors.cyanBorder,
  },
  noteContentContainer: {
    gap: 8,
    marginVertical: 4,
  },
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  miniCopyBtn: {
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
  miniCopyText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.cyan,
  },
  noteBox: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
  },
  noteText: {
    fontSize: 12.5,
    color: colors.text,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  revealNoteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    backgroundColor: colors.surface2,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  revealNoteText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.cyan,
  },
  recipientPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  recipientPill: {
    backgroundColor: colors.cyanBg,
    borderWidth: 1,
    borderColor: colors.cyanBorder,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  recipientPillText: {
    fontSize: 10.5,
    color: colors.cyan,
    fontWeight: '600',
  },
});
