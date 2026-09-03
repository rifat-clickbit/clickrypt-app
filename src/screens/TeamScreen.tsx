import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Share,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { colors } from '../theme/colors';
import { Header } from '../components/Header';
import { PasswordCard } from '../components/PasswordCard';
import { PasswordDrawerModal } from '../components/PasswordDrawerModal';
import { ShareModal } from '../components/ShareModal';
import {
  LucideFolder,
  LucideFolderOpen,
  LucideUsers,
  LucidePlus,
  LucideArrowLeft,
  LucideTrash2,
  LucideKeyRound,
  ChevronRightIcon,
  CopyIcon,
  CheckIcon,
} from '../components/Icons';
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useVault } from '../context/VaultContext';
import { useTheme } from '../theme/ThemeContext';
import { VaultItem, FolderItem } from '../types';

interface MemberItem {
  id: string;
  name: string;
  email: string;
  role: string;
  initials: string;
  status?: string;
  avatarUrl?: string;
}

interface GroupItem {
  id: string;
  name: string;
  description: string;
  memberIds?: string[];
  folderIds?: string[];
  assignedFolderIds?: string[];
  assignedResourceIds?: string[];
  createdBy?: string;
  memberCount?: number;
  lastActive?: string;
}

export const TeamScreen = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { appMode, user } = useAuth();
  const { items, folders, deleteItem, refreshVault } = useVault();

  // Root subTab
  const [subTab, setSubTab] = useState<'members' | 'groups'>('members');

  // Selected group for drill-down view
  const [selectedGroup, setSelectedGroup] = useState<GroupItem | null>(null);
  const [groupSubTab, setGroupSubTab] = useState<'members' | 'folders' | 'passwords'>('members');

  // Modals inside Group view
  const [addMemberModalVisible, setAddMemberModalVisible] = useState(false);
  const [assignFolderModalVisible, setAssignFolderModalVisible] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareItem, setShareItem] = useState<VaultItem | null>(null);

  // Members state
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'Admin' | 'Member' | 'Viewer'>('Member');
  const [generatedInviteLink, setGeneratedInviteLink] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [members, setMembers] = useState<MemberItem[]>([]);

  // Groups state
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groups, setGroups] = useState<GroupItem[]>([]);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchData();

    // Realtime WebSocket channel for Team, Groups, Members, and Folders
    const channelName = `team_sync_${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        fetchData(false);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, () => {
        fetchData(false);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, () => {
        fetchData(false);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_folders' }, () => {
        fetchData(false);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, () => {
        fetchData(false);
      })
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
  }, [appMode]);

  const fetchData = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      // 1. Fetch Users
      const { data: userData } = await supabase.from('users').select('*').limit(50);
      let userList: MemberItem[] = [];
      if (userData && userData.length > 0) {
        userList = userData.map((u: any) => {
          const name = u.name || u.data?.name || u.email?.split('@')[0] || 'Member';
          const initials = name
            .split(' ')
            .filter(Boolean)
            .map((p: string) => p[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();
          return {
            id: u.id,
            name,
            email: u.email || 'user@clickbit.com.au',
            role: u.data?.role || u.role || 'Member',
            initials: initials || 'US',
            status: u.data?.status || 'Active',
          };
        });
      }
      setMembers(userList);

      // 2. Fetch Groups & Join Tables
      const { data: groupData } = await supabase.from('groups').select('*');
      const { data: groupMembersData } = await supabase.from('group_members').select('*');
      const { data: groupFoldersData } = await supabase.from('group_folders').select('*');

      if (groupData && groupData.length > 0) {
        setGroups(
          groupData.map((g: any) => {
            const relMemberIds = (groupMembersData || [])
              .filter((gm: any) => gm.group_id === g.id)
              .map((gm: any) => gm.user_id);
            const relFolderIds = (groupFoldersData || [])
              .filter((gf: any) => gf.group_id === g.id)
              .map((gf: any) => gf.folder_id);

            const finalMemberIds = relMemberIds.length > 0 ? relMemberIds : (g.data?.memberIds || []);
            const finalFolderIds = relFolderIds.length > 0 ? relFolderIds : (g.data?.folderIds || []);

            return {
              id: g.id,
              name: g.name || g.data?.name || 'Group',
              description: g.description || g.data?.description || 'Organization access group',
              memberIds: finalMemberIds,
              folderIds: finalFolderIds,
              createdBy: g.created_by,
              memberCount: finalMemberIds.length,
              lastActive: g.data?.lastActive || 'Active today',
            };
          })
        );
      } else {
        setGroups([]);
      }
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInvite = async () => {
    if (!inviteEmail.trim()) {
      Alert.alert('Email Required', 'Please enter work email address to invite.');
      return;
    }

    const token = Math.random().toString(36).substring(2, 12);
    const link = `https://clickbit.com.au/join-organization?token=${token}&email=${encodeURIComponent(
      inviteEmail.trim()
    )}&role=${inviteRole}`;

    const orgId = user?.organizationId || (user?.email ? `org-${user.email.split('@')[1].replace(/[^a-z0-9]/g, '')}` : `org-${user?.id}`);

    const newMember: MemberItem = {
      id: `usr-inv-${Date.now()}`,
      name: inviteName.trim() || inviteEmail.split('@')[0],
      email: inviteEmail.trim().toLowerCase(),
      role: inviteRole,
      initials: (inviteName.trim() || inviteEmail).slice(0, 2).toUpperCase(),
      status: 'Invited',
    };

    setMembers([newMember, ...members]);
    setGeneratedInviteLink(link);

    try {
      // 1. Explicitly register member under managed organization
      await supabase.from('users').upsert({
        id: newMember.id,
        email: newMember.email,
        name: newMember.name,
        account_mode: 'organization',
        organization_id: orgId,
        managed_by_organization_id: orgId,
        data: {
          ...newMember,
          organizationId: orgId,
          managedByOrganizationId: orgId,
          status: 'Invited',
          invitedAt: new Date().toISOString(),
          inviteLink: link,
        },
      });

      // 2. Explicitly create membership relation row
      await supabase.from('organization_members').upsert({
        id: `om-${Date.now()}`,
        organization_id: orgId,
        user_id: newMember.id,
        role: inviteRole,
        is_managed_account: true,
        status: 'invited',
        invited_by: user?.id,
      });
    } catch {
      // ignore
    }
  };

  const handleShareInviteLink = async () => {
    if (!generatedInviteLink) return;
    try {
      await Share.share({
        title: 'ClickRypt Organization Invitation',
        message: `You've been invited to join the ClickRypt Organization Vault as a ${inviteRole}:\n${generatedInviteLink}`,
      });
    } catch {
      // ignore
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) return;
    const currentMemberIds = members.slice(0, 1).map((m) => m.id);
    const newGroup: GroupItem = {
      id: `grp-${Date.now()}`,
      name: groupName.trim(),
      description: groupDesc.trim() || 'Organization custom user group',
      memberIds: currentMemberIds,
      folderIds: [],
      memberCount: currentMemberIds.length,
      createdBy: user?.id,
      lastActive: 'Just now',
    };

    setGroups([newGroup, ...groups]);

    try {
      await supabase.from('groups').upsert({
        id: newGroup.id,
        name: newGroup.name,
        description: newGroup.description,
        created_by: user?.id,
        data: newGroup,
      });

      for (const uid of currentMemberIds) {
        await supabase.from('group_members').upsert({
          group_id: newGroup.id,
          user_id: uid,
        });
      }
    } catch {
      // ignore
    }

    setGroupName('');
    setGroupDesc('');
    setGroupModalVisible(false);
    Alert.alert('Group Created', `Group "${newGroup.name}" created successfully.`);
  };

  const handleDeleteGroup = (group: GroupItem) => {
    Alert.alert(
      'Delete Group',
      `Are you sure you want to delete the group "${group.name}"? Members and credentials will remain safe.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Group',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('groups').delete().eq('id', group.id);
            if (selectedGroup?.id === group.id) {
              setSelectedGroup(null);
            }
            setGroups(groups.filter((g) => g.id !== group.id));
          },
        },
      ]
    );
  };

  // Add member to current group
  const handleAddMemberToGroup = async (memberId: string) => {
    if (!selectedGroup) return;
    const currentMemberIds = selectedGroup.memberIds || [];
    if (currentMemberIds.includes(memberId)) return;

    const updatedMemberIds = [...currentMemberIds, memberId];
    const updatedGroup = {
      ...selectedGroup,
      memberIds: updatedMemberIds,
      memberCount: updatedMemberIds.length,
    };

    setSelectedGroup(updatedGroup);
    setGroups(groups.map((g) => (g.id === updatedGroup.id ? updatedGroup : g)));

    await supabase.from('groups').upsert({
      id: updatedGroup.id,
      name: updatedGroup.name,
      description: updatedGroup.description,
      data: updatedGroup,
    });

    await supabase.from('group_members').upsert({
      group_id: updatedGroup.id,
      user_id: memberId,
    });

    setAddMemberModalVisible(false);
  };

  // Remove member from current group
  const handleRemoveMemberFromGroup = async (memberId: string) => {
    if (!selectedGroup) return;
    const updatedMemberIds = (selectedGroup.memberIds || []).filter((id) => id !== memberId);
    const updatedGroup = {
      ...selectedGroup,
      memberIds: updatedMemberIds,
      memberCount: updatedMemberIds.length,
    };

    setSelectedGroup(updatedGroup);
    setGroups(groups.map((g) => (g.id === updatedGroup.id ? updatedGroup : g)));

    await supabase.from('groups').upsert({
      id: updatedGroup.id,
      name: updatedGroup.name,
      description: updatedGroup.description,
      data: updatedGroup,
    });

    await supabase.from('group_members').delete().eq('group_id', updatedGroup.id).eq('user_id', memberId);
  };

  // Assign folder to current group
  const handleAssignFolderToGroup = async (folderId: string) => {
    if (!selectedGroup) return;
    const currentFolderIds = selectedGroup.folderIds || [];
    if (currentFolderIds.includes(folderId)) return;

    const updatedFolderIds = [...currentFolderIds, folderId];
    const updatedGroup = {
      ...selectedGroup,
      folderIds: updatedFolderIds,
    };

    setSelectedGroup(updatedGroup);
    setGroups(groups.map((g) => (g.id === updatedGroup.id ? updatedGroup : g)));

    await supabase.from('groups').upsert({
      id: updatedGroup.id,
      name: updatedGroup.name,
      description: updatedGroup.description,
      data: updatedGroup,
    });

    await supabase.from('group_folders').upsert({
      group_id: updatedGroup.id,
      folder_id: folderId,
    });

    setAssignFolderModalVisible(false);
  };

  // Unassign folder from current group
  const handleUnassignFolderFromGroup = async (folderId: string) => {
    if (!selectedGroup) return;
    const updatedFolderIds = (selectedGroup.folderIds || []).filter((id) => id !== folderId);
    const updatedGroup = {
      ...selectedGroup,
      folderIds: updatedFolderIds,
    };

    setSelectedGroup(updatedGroup);
    setGroups(groups.map((g) => (g.id === updatedGroup.id ? updatedGroup : g)));

    await supabase.from('groups').upsert({
      id: updatedGroup.id,
      name: updatedGroup.name,
      description: updatedGroup.description,
      data: updatedGroup,
    });

    await supabase.from('group_folders').delete().eq('group_id', updatedGroup.id).eq('folder_id', folderId);
  };

  /* ----------------------------------------------------
     GROUP DRILL-DOWN VIEW (Members, Folders & Passwords)
  ----------------------------------------------------- */
  if (selectedGroup) {
    const groupMemberIds = selectedGroup.memberIds || [];
    const groupFolderIds = selectedGroup.folderIds || [];

    const groupMembers = members.filter((m) => groupMemberIds.includes(m.id));
    const groupFolders = folders.filter((f) => groupFolderIds.includes(f.id));
    const groupPasswords = items.filter(
      (i) => !i.isDeleted && ((i.folderId && groupFolderIds.includes(i.folderId)) || groupFolderIds.length === 0)
    );

    const availableMembersToAdd = members.filter((m) => !groupMemberIds.includes(m.id));
    const availableFoldersToAssign = folders.filter((f) => !groupFolderIds.includes(f.id));

    return (
      <View style={styles.container}>
        {/* Custom Group Header */}
        <View style={styles.drillHeader}>
          <TouchableOpacity
            style={styles.backBtn}
            activeOpacity={0.7}
            onPress={() => setSelectedGroup(null)}
          >
            <LucideArrowLeft size={16} color={colors.cyan} strokeWidth={2.5} />
            <Text style={styles.backBtnText}>User Groups</Text>
          </TouchableOpacity>

          <View style={styles.folderTitleRow}>
            <View style={styles.folderTitleLeft}>
              <LucideFolderOpen size={20} color={colors.cyan} />
              <View style={{ flex: 1 }}>
                <Text style={styles.drillTitle} numberOfLines={1}>
                  {selectedGroup.name}
                </Text>
                <Text style={styles.drillSub} numberOfLines={1}>
                  {selectedGroup.description}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.deleteFolderIconBtn}
              onPress={() => handleDeleteGroup(selectedGroup)}
            >
              <LucideTrash2 size={16} color={colors.danger} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Group Sub-Navigation Segment Tabs */}
        <View style={styles.subNav}>
          <TouchableOpacity
            style={[styles.subNavTab, groupSubTab === 'members' && styles.subNavTabActive]}
            onPress={() => setGroupSubTab('members')}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <LucideUsers
                size={13}
                color={groupSubTab === 'members' ? colors.cyan : colors.textMuted}
              />
              <Text
                style={[styles.subNavText, groupSubTab === 'members' && styles.subNavTextActive]}
              >
                Members ({groupMembers.length})
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.subNavTab, groupSubTab === 'folders' && styles.subNavTabActive]}
            onPress={() => setGroupSubTab('folders')}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <LucideFolder
                size={13}
                color={groupSubTab === 'folders' ? colors.cyan : colors.textMuted}
              />
              <Text
                style={[styles.subNavText, groupSubTab === 'folders' && styles.subNavTextActive]}
              >
                Folders ({groupFolders.length})
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.subNavTab, groupSubTab === 'passwords' && styles.subNavTabActive]}
            onPress={() => setGroupSubTab('passwords')}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <LucideKeyRound
                size={13}
                color={groupSubTab === 'passwords' ? colors.cyan : colors.textMuted}
              />
              <Text
                style={[styles.subNavText, groupSubTab === 'passwords' && styles.subNavTextActive]}
              >
                Passwords ({groupPasswords.length})
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {/* TAB 1: GROUP MEMBERS */}
          {groupSubTab === 'members' && (
            <View style={{ gap: 8 }}>
              <TouchableOpacity
                style={styles.actionBanner}
                activeOpacity={0.8}
                onPress={() => setAddMemberModalVisible(true)}
              >
                <LucidePlus size={15} color="#062229" strokeWidth={2.5} />
                <Text style={styles.actionBannerText}>Add Member to Group</Text>
              </TouchableOpacity>

              {groupMembers.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>No members in this group</Text>
                  <Text style={styles.emptySubtitle}>
                    Tap "+ Add Member" to assign colleagues to {selectedGroup.name}.
                  </Text>
                </View>
              ) : (
                groupMembers.map((member) => (
                  <View key={member.id} style={styles.card}>
                    <View style={styles.cardLeft}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{member.initials}</Text>
                      </View>
                      <View>
                        <Text style={styles.title}>{member.name}</Text>
                        <Text style={styles.sub}>{member.email}</Text>
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={styles.roleBadge}>
                        <Text style={styles.roleText}>{member.role}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.removeBtn}
                        onPress={() => handleRemoveMemberFromGroup(member.id)}
                      >
                        <Text style={styles.removeBtnText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

          {/* TAB 2: GROUP FOLDERS */}
          {groupSubTab === 'folders' && (
            <View style={{ gap: 8 }}>
              <TouchableOpacity
                style={styles.actionBanner}
                activeOpacity={0.8}
                onPress={() => setAssignFolderModalVisible(true)}
              >
                <LucidePlus size={15} color="#062229" strokeWidth={2.5} />
                <Text style={styles.actionBannerText}>Assign Folder to Group</Text>
              </TouchableOpacity>

              {groupFolders.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>No folders assigned</Text>
                  <Text style={styles.emptySubtitle}>
                    Assign vault folders to grant group members shared credential access.
                  </Text>
                </View>
              ) : (
                groupFolders.map((folder) => {
                  const count = items.filter((i) => i.folderId === folder.id).length;
                  return (
                    <View key={folder.id} style={styles.card}>
                      <View style={styles.cardLeft}>
                        <View style={[styles.avatar, { backgroundColor: colors.warningBg }]}>
                          <LucideFolder size={18} color={colors.warning} />
                        </View>
                        <View>
                          <Text style={styles.title}>{folder.name}</Text>
                          <Text style={styles.sub}>{count} passwords inside</Text>
                        </View>
                      </View>

                      <TouchableOpacity
                        style={styles.removeBtn}
                        onPress={() => handleUnassignFolderFromGroup(folder.id)}
                      >
                        <Text style={styles.removeBtnText}>Unassign</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </View>
          )}

          {/* TAB 3: GROUP PASSWORDS */}
          {groupSubTab === 'passwords' && (
            <View style={{ gap: 8 }}>
              <TouchableOpacity
                style={styles.actionBanner}
                activeOpacity={0.8}
                onPress={() => {
                  setEditingItem(null);
                  setIsDrawerOpen(true);
                }}
              >
                <LucidePlus size={15} color="#062229" strokeWidth={2.5} />
                <Text style={styles.actionBannerText}>Add Password to Group</Text>
              </TouchableOpacity>

              {groupPasswords.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>No group passwords yet</Text>
                  <Text style={styles.emptySubtitle}>
                    Passwords belonging to assigned folders will appear here for group members.
                  </Text>
                </View>
              ) : (
                groupPasswords.map((item, index) => (
                  <PasswordCard
                    key={item.id}
                    item={item}
                    initialExpanded={index === 0}
                    onEdit={(it) => {
                      setEditingItem(it);
                      setIsDrawerOpen(true);
                    }}
                    onShare={(it) => {
                      setShareItem(it);
                      setIsShareModalOpen(true);
                    }}
                    onDelete={deleteItem}
                  />
                ))
              )}
            </View>
          )}
        </ScrollView>

        {/* Add Member to Group Modal */}
        <Modal visible={addMemberModalVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Add Member to {selectedGroup.name}</Text>
              <Text style={styles.modalSubtitle}>
                Select an organization colleague to assign to this user group.
              </Text>

              <ScrollView style={{ maxHeight: 220 }}>
                {availableMembersToAdd.length === 0 ? (
                  <Text style={styles.emptySubtitle}>All organization members are already in this group.</Text>
                ) : (
                  availableMembersToAdd.map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={styles.pickerRow}
                      onPress={() => handleAddMemberToGroup(m.id)}
                    >
                      <View style={styles.cardLeft}>
                        <View style={styles.avatar}>
                          <Text style={styles.avatarText}>{m.initials}</Text>
                        </View>
                        <View>
                          <Text style={styles.title}>{m.name}</Text>
                          <Text style={styles.sub}>{m.email}</Text>
                        </View>
                      </View>
                      <LucidePlus size={16} color={colors.cyan} />
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancel}
                  onPress={() => setAddMemberModalVisible(false)}
                >
                  <Text style={styles.modalCancelText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Assign Folder to Group Modal */}
        <Modal visible={assignFolderModalVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Assign Folder to {selectedGroup.name}</Text>
              <Text style={styles.modalSubtitle}>
                Grant all members of this group shared access to a vault folder.
              </Text>

              <ScrollView style={{ maxHeight: 220 }}>
                {availableFoldersToAssign.length === 0 ? (
                  <Text style={styles.emptySubtitle}>All vault folders are already assigned to this group.</Text>
                ) : (
                  availableFoldersToAssign.map((f) => (
                    <TouchableOpacity
                      key={f.id}
                      style={styles.pickerRow}
                      onPress={() => handleAssignFolderToGroup(f.id)}
                    >
                      <View style={styles.cardLeft}>
                        <View style={[styles.avatar, { backgroundColor: colors.warningBg }]}>
                          <LucideFolder size={16} color={colors.warning} />
                        </View>
                        <Text style={styles.title}>{f.name}</Text>
                      </View>
                      <LucidePlus size={16} color={colors.cyan} />
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancel}
                  onPress={() => setAssignFolderModalVisible(false)}
                >
                  <Text style={styles.modalCancelText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Add Password Drawer Modal */}
        <PasswordDrawerModal
          visible={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          editItem={editingItem}
          defaultFolderId={groupFolderIds[0] || undefined}
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

  /* ----------------------------------------------------
     ROOT TEAM & USER GROUPS DIRECTORY
  ----------------------------------------------------- */
  return (
    <View style={styles.container}>
      <Header
        title="Organization Team"
        itemCount={subTab === 'members' ? members.length : groups.length}
        onAddPress={() => {
          if (subTab === 'members') {
            setGeneratedInviteLink('');
            setInviteName('');
            setInviteEmail('');
            setInviteRole('Member');
            setInviteModalVisible(true);
          } else {
            setGroupModalVisible(true);
          }
        }}
      />

      {/* Sub-navigation Segmented Controller */}
      <View style={styles.subNav}>
        <TouchableOpacity
          style={[styles.subNavTab, subTab === 'members' && styles.subNavTabActive]}
          onPress={() => setSubTab('members')}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <LucideUsers
              size={13}
              color={subTab === 'members' ? colors.cyan : colors.textMuted}
            />
            <Text style={[styles.subNavText, subTab === 'members' && styles.subNavTextActive]}>
              Team Members ({members.length})
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.subNavTab, subTab === 'groups' && styles.subNavTabActive]}
          onPress={() => setSubTab('groups')}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <LucideFolder
              size={13}
              color={subTab === 'groups' ? colors.cyan : colors.textMuted}
            />
            <Text style={[styles.subNavText, subTab === 'groups' && styles.subNavTextActive]}>
              User Groups ({groups.length})
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {loading && members.length === 0 ? (
          <ActivityIndicator size="large" color={colors.cyan} style={{ marginTop: 40 }} />
        ) : subTab === 'members' ? (
          /* Members List */
          members.map((member) => (
            <View key={member.id} style={styles.card}>
              <View style={styles.cardLeft}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{member.initials}</Text>
                </View>
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.title}>{member.name}</Text>
                    {member.status === 'Invited' && (
                      <View style={styles.invitedPill}>
                        <Text style={styles.invitedPillText}>Invited</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.sub}>{member.email}</Text>
                </View>
              </View>

              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>{member.role}</Text>
              </View>
            </View>
          ))
        ) : (
          /* Groups List with Clickable Navigation to Drill-Down */
          groups.map((group) => (
            <TouchableOpacity
              key={group.id}
              style={styles.card}
              activeOpacity={0.7}
              onPress={() => setSelectedGroup(group)}
            >
              <View style={styles.cardLeft}>
                <View style={[styles.avatar, styles.groupAvatar]}>
                  <LucideUsers size={16} color={colors.cyan} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{group.name}</Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {group.description}
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={styles.groupBadge}>
                  <Text style={styles.groupBadgeText}>
                    {(group.memberIds || []).length || group.memberCount || 1} members
                  </Text>
                </View>
                <ChevronRightIcon size={14} color={colors.textMuted} />
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Invite Member Modal */}
      <Modal visible={inviteModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={{ paddingVertical: 20 }}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Invite Team Member</Text>
              <Text style={styles.modalSubtitle}>
                Add a colleague to your organization vault with role-based access.
              </Text>

              {/* Name */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Full Name</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. Alex Morgan"
                  placeholderTextColor={colors.textMuted}
                  value={inviteName}
                  onChangeText={setInviteName}
                />
              </View>

              {/* Email */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Work Email Address</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="alex.morgan@company.com"
                  placeholderTextColor={colors.textMuted}
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              {/* Role Selection Chips */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Access Role</Text>
                <View style={styles.roleChipRow}>
                  {(['Admin', 'Member', 'Viewer'] as const).map((r) => {
                    const isSelected = inviteRole === r;
                    return (
                      <TouchableOpacity
                        key={r}
                        style={[styles.roleChip, isSelected && styles.roleChipActive]}
                        onPress={() => setInviteRole(r)}
                      >
                        <Text
                          style={[
                            styles.roleChipText,
                            isSelected && styles.roleChipTextActive,
                          ]}
                        >
                          {r}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {!generatedInviteLink ? (
                <TouchableOpacity
                  style={styles.modalSubmitFull}
                  activeOpacity={0.8}
                  onPress={handleCreateInvite}
                >
                  <Text style={styles.modalSubmitText}>Generate Invitation Link</Text>
                </TouchableOpacity>
              ) : (
                <View style={{ gap: 10, marginTop: 6 }}>
                  <Text style={styles.successLabel}>
                    ✓ Invitation link created for {inviteEmail}
                  </Text>

                  <View style={styles.linkContainer}>
                    <Text style={styles.linkText} numberOfLines={1}>
                      {generatedInviteLink}
                    </Text>
                    <TouchableOpacity
                      style={styles.copyBtn}
                      onPress={async () => {
                        await Clipboard.setStringAsync(generatedInviteLink);
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                    >
                      <CopyIcon size={13} color={copiedLink ? colors.success : colors.cyan} />
                      <Text
                        style={[
                          styles.copyBtnText,
                          copiedLink && { color: colors.success },
                        ]}
                      >
                        {copiedLink ? 'Copied' : 'Copy'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={[styles.modalSubmitFull, { backgroundColor: colors.cyan }]}
                    onPress={handleShareInviteLink}
                  >
                    <Text style={styles.modalSubmitText}>
                      Send via WhatsApp / Slack / Email
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancel}
                  onPress={() => setInviteModalVisible(false)}
                >
                  <Text style={styles.modalCancelText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Create Group Modal */}
      <Modal visible={groupModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create User Group</Text>
            <Text style={styles.modalSubtitle}>
              Group members together to assign bulk folder and secret access.
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Group Name (e.g. Infrastructure Leads)"
              placeholderTextColor={colors.textMuted}
              value={groupName}
              onChangeText={setGroupName}
            />

            <TextInput
              style={[styles.modalInput, { marginTop: 10 }]}
              placeholder="Description (Optional)"
              placeholderTextColor={colors.textMuted}
              value={groupDesc}
              onChangeText={setGroupDesc}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setGroupModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSubmit} onPress={handleCreateGroup}>
                <Text style={styles.modalSubmitText}>Create Group</Text>
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
    gap: 10,
    flex: 1,
  },
  drillTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  drillSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  deleteFolderIconBtn: {
    padding: 6,
  },
  actionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.cyan,
    marginVertical: 4,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionBannerText: {
    color: '#062229',
    fontSize: 13,
    fontWeight: '700',
  },
  subNav: {
    flexDirection: 'row',
    marginHorizontal: 18,
    marginTop: 8,
    marginBottom: 6,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  subNavTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  subNavTabActive: {
    backgroundColor: colors.cyanBg,
  },
  subNavText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.textMuted,
  },
  subNavTextActive: {
    color: colors.cyan,
  },
  list: {
    flex: 1,
    paddingHorizontal: 18,
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 24,
    gap: 9,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 13,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: colors.cyanBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupAvatar: {
    backgroundColor: colors.cyanBg,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.cyan,
  },
  title: {
    fontSize: 13.5,
    fontWeight: '600',
    color: colors.text,
  },
  sub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  roleBadge: {
    backgroundColor: colors.cyanBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  roleText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.cyan,
  },
  removeBtn: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  removeBtnText: {
    fontSize: 11,
    color: colors.danger,
    fontWeight: '600',
  },
  groupBadge: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  groupBadgeText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  emptySubtitle: {
    fontSize: 11.5,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 16,
  },
  invitedPill: {
    backgroundColor: colors.warningBg,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  invitedPillText: {
    fontSize: 9.5,
    color: colors.warning,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 12, 0.75)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 18,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  modalSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  field: {
    gap: 4,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  modalInput: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 13,
  },
  roleChipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  roleChip: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  roleChipActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanBg,
  },
  roleChipText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  roleChipTextActive: {
    color: colors.cyan,
  },
  modalSubmitFull: {
    backgroundColor: colors.cyan,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  successLabel: {
    fontSize: 12,
    color: colors.success,
    fontWeight: '600',
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
  },
  linkText: {
    flex: 1,
    fontSize: 11.5,
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
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  modalCancel: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  modalSubmit: {
    backgroundColor: colors.cyan,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalSubmitText: {
    color: '#062229',
    fontSize: 13,
    fontWeight: '700',
  },
});
