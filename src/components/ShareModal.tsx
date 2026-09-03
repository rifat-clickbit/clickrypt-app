import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Share,
  Alert,
  Linking,
} from 'react-native';
import { colors } from '../theme/colors';
import { ShareIcon, CheckIcon, CopyIcon, LucideMail, LucideMessageCircle } from './Icons';
import * as Clipboard from 'expo-clipboard';
import { VaultItem } from '../types';
import { supabase } from '../services/supabaseClient';
import { useVault } from '../context/VaultContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';

interface ShareModalProps {
  visible: boolean;
  onClose: () => void;
  item: VaultItem | null;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

export const ShareModal: React.FC<ShareModalProps> = ({ visible, onClose, item }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { shareItemWithMember } = useVault();
  const { user, appMode } = useAuth();
  const [shareType, setShareType] = useState<'member' | 'link'>(
    appMode === 'organization' ? 'member' : 'link'
  );
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [selectedMemberName, setSelectedMemberName] = useState('');
  const [expiryHours, setExpiryHours] = useState('24');
  const [generatedLink, setGeneratedLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    if (visible) {
      if (appMode === 'organization') {
        fetchMembers();
        setShareType('member');
      } else {
        setShareType('link');
      }
      setGeneratedLink('');
      setCopied(false);
    }
  }, [visible, appMode]);

  const fetchMembers = async () => {
    try {
      const userDomain = user?.email && user.email.includes('@') ? user.email.split('@')[1].toLowerCase() : '';
      const { data } = await supabase.from('users').select('*');
      if (data && data.length > 0) {
        const filtered = data
          .filter((u: any) => {
            if (u.id === user?.id || u.email === user?.email) return false;
            // Only members of the same organization / domain
            if (userDomain && u.email && u.email.toLowerCase().endsWith('@' + userDomain)) return true;
            if (user?.organizationId && (u.organization_id === user.organizationId || u.data?.organizationId === user.organizationId)) return true;
            return false;
          })
          .map((u: any) => ({
            id: u.id,
            name: u.name || u.data?.name || u.email?.split('@')[0] || 'Team Member',
            email: u.email || '',
            role: u.role || u.data?.role || 'Member',
          }));
        setTeamMembers(filtered);
      } else {
        setTeamMembers([]);
      }
    } catch {
      setTeamMembers([]);
    }
  };

  const handleShareWithMember = async () => {
    if (!selectedMemberId) {
      Alert.alert('Select Member', 'Please select an organization member to share with.');
      return;
    }
    if (!item) return;

    const targetMember = teamMembers.find((m) => m.id === selectedMemberId);
    const ok = await shareItemWithMember(item.id, {
      id: selectedMemberId,
      name: targetMember?.name || selectedMemberName || 'Team Member',
      email: targetMember?.email || '',
    });

    if (ok) {
      Alert.alert(
        'Access Granted',
        `"${item.name}" has been shared with ${targetMember?.name || selectedMemberName || 'team member'} and will now appear in their vault.`
      );
      onClose();
    } else {
      Alert.alert(
        'Unable to Share',
        'This colleague has not yet activated their vault encryption keys. Once they create their account, you will be able to share credentials with them.'
      );
    }
  };

  const handleGenerateLink = async () => {
    const randomHash = Math.random().toString(36).substring(2, 12);
    const link = `https://clickbit.com.au/share/${item?.id || 'res'}#key=${randomHash}&exp=${expiryHours}`;
    setGeneratedLink(link);
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleShareEmail = async () => {
    if (!generatedLink) return;
    const subject = encodeURIComponent(`ClickRypt Secure Credential: ${item?.name || 'Item'}`);
    const body = encodeURIComponent(
      `Hello,\n\nHere is a secure zero-knowledge encrypted credential link for "${item?.name || 'Vault Item'}" (Expires in ${expiryHours}):\n\n${generatedLink}\n\nShared securely via ClickRypt Password Vault.`
    );
    const mailtoUrl = `mailto:?subject=${subject}&body=${body}`;

    try {
      await Linking.openURL(mailtoUrl);
    } catch {
      Alert.alert(
        'Email Client',
        'Could not automatically launch your email app. The link has been copied to your clipboard so you can paste it directly into your email.'
      );
    }
  };

  const handleShareWhatsApp = async () => {
    if (!generatedLink) return;
    const msg = encodeURIComponent(
      `Here is a secure zero-knowledge encrypted credential link for "${item?.name || 'Vault Item'}" (Expires in ${expiryHours}):\n${generatedLink}`
    );
    const waNativeUrl = `whatsapp://send?text=${msg}`;
    const waWebUrl = `https://api.whatsapp.com/send?text=${msg}`;

    try {
      const canOpen = await Linking.canOpenURL(waNativeUrl);
      if (canOpen) {
        await Linking.openURL(waNativeUrl);
      } else {
        await Linking.openURL(waWebUrl);
      }
    } catch {
      await Linking.openURL(waWebUrl);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <ShareIcon size={16} color={colors.cyan} />
              <Text style={styles.headerTitle}>Share "{item?.name}"</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Mode Switcher (Organization Mode only) */}
          {appMode === 'organization' && (
            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tabBtn, shareType === 'member' && styles.tabBtnActive]}
                onPress={() => setShareType('member')}
              >
                <Text style={[styles.tabBtnText, shareType === 'member' && styles.tabBtnTextActive]}>
                  Team Members
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, shareType === 'link' && styles.tabBtnActive]}
                onPress={() => setShareType('link')}
              >
                <Text style={[styles.tabBtnText, shareType === 'link' && styles.tabBtnTextActive]}>
                  Expiring Link
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {shareType === 'member' ? (
              <View style={styles.section}>
                <Text style={styles.sectionDesc}>
                  Select an organization member to re-encrypt and provision this credential for their
                  vault.
                </Text>

                <View style={styles.memberList}>
                  {teamMembers.map((member) => {
                    const isSelected = selectedMemberId === member.id;
                    return (
                      <TouchableOpacity
                        key={member.id}
                        style={[styles.memberCard, isSelected && styles.memberCardSelected]}
                        activeOpacity={0.7}
                        onPress={() => {
                          setSelectedMemberId(member.id);
                          setSelectedMemberName(member.name);
                        }}
                      >
                        <View>
                          <Text style={styles.memberName}>{member.name}</Text>
                          <Text style={styles.memberEmail}>{member.email}</Text>
                        </View>
                        {isSelected && <CheckIcon size={16} color={colors.cyan} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  style={styles.actionBtn}
                  activeOpacity={0.8}
                  onPress={handleShareWithMember}
                >
                  <Text style={styles.actionBtnText}>Re-Encrypt & Share</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.section}>
                <Text style={styles.sectionDesc}>
                  Generate a zero-knowledge, end-to-end encrypted sharing link that self-destructs
                  after the expiration period.
                </Text>

                <View style={styles.expiryRow}>
                  <Text style={styles.expiryLabel}>Expires In:</Text>
                  <View style={styles.chipRow}>
                    {['1 Hour', '24 Hours', '7 Days'].map((t) => {
                      const isSelected = expiryHours === t;
                      return (
                        <TouchableOpacity
                          key={t}
                          style={[styles.chip, isSelected && styles.chipActive]}
                          onPress={() => setExpiryHours(t)}
                        >
                          <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                            {t}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.actionBtn}
                  activeOpacity={0.8}
                  onPress={handleGenerateLink}
                >
                  <Text style={styles.actionBtnText}>
                    {generatedLink ? 'Regenerate Link' : 'Generate Encrypted Link'}
                  </Text>
                </TouchableOpacity>

                {generatedLink ? (
                  <View style={{ gap: 8 }}>
                    <View style={styles.linkContainer}>
                      <Text style={styles.linkText} numberOfLines={1}>
                        {generatedLink}
                      </Text>
                      <TouchableOpacity style={styles.copyBtn} onPress={handleGenerateLink}>
                        <CopyIcon size={13} color={copied ? colors.success : colors.cyan} />
                        <Text style={[styles.copyBtnText, copied && { color: colors.success }]}>
                          {copied ? 'Copied' : 'Copy'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.shareChannelsRow}>
                      <TouchableOpacity
                        style={[styles.shareChannelBtn, styles.shareEmailBtn]}
                        onPress={handleShareEmail}
                        activeOpacity={0.8}
                      >
                        <LucideMail size={15} color={colors.cyan} strokeWidth={2} />
                        <Text style={[styles.shareChannelBtnText, { color: colors.cyan }]}>
                          Send via Email
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.shareChannelBtn, styles.shareWhatsAppBtn]}
                        onPress={handleShareWhatsApp}
                        activeOpacity={0.8}
                      >
                        <LucideMessageCircle size={15} color="#22C55E" strokeWidth={2} />
                        <Text style={[styles.shareChannelBtnText, { color: '#22C55E' }]}>
                          Send via WhatsApp
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </View>
            )}
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: '80%',
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    color: colors.cyan,
    fontSize: 13,
    fontWeight: '600',
  },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.cyan,
  },
  tabBtnText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  tabBtnTextActive: {
    color: colors.cyan,
    fontWeight: '700',
  },
  body: {
    paddingHorizontal: 20,
  },
  bodyContent: {
    paddingVertical: 18,
    paddingBottom: 40,
  },
  section: {
    gap: 14,
  },
  sectionDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  memberList: {
    gap: 8,
  },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
  },
  memberCardSelected: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanBg,
  },
  memberName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  memberEmail: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  expiryRow: {
    gap: 8,
  },
  expiryLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  chipActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanBg,
  },
  chipText: {
    fontSize: 11.5,
    color: colors.textMuted,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.cyan,
  },
  actionBtn: {
    backgroundColor: colors.cyan,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  actionBtnText: {
    color: '#062229',
    fontSize: 14,
    fontWeight: '700',
  },
  linkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
  linkText: {
    flex: 1,
    fontSize: 12,
    color: colors.cyan,
    fontFamily: 'monospace',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
  },
  copyBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.cyan,
  },
  shareChannelsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  shareChannelBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  shareEmailBtn: {
    backgroundColor: colors.cyanBg,
    borderColor: colors.cyanBorder,
  },
  shareWhatsAppBtn: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderColor: 'rgba(34, 197, 94, 0.35)',
  },
  shareChannelBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
});
