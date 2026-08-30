/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabaseClient';
import { useAuth } from './AuthContext';
import { VaultItem, FolderItem } from '../types';
import {
  encryptSecret,
  decryptSecret,
  generateSymmetricKey,
  encryptWithPublicKey,
  decryptWithPrivateKey,
  isEncryptedCipher,
  resolveBestSecret,
} from '../crypto/cryptoEngine';
import { checkPasswordBreach } from '../services/breachScanner';
import { queueMutation, setupOfflineAutoSync } from '../services/offlineQueue';
import { logActivity } from '../services/activityLogService';

export type FilterMode =
  | 'all'
  | 'leaked'
  | 'outdated'
  | 'own'
  | 'sharedWithMe'
  | 'sharedByMe'
  | 'lastModified'
  | 'notes'
  | 'trash';

export type TabType = 'passwords' | 'cards' | 'folders' | 'team' | 'settings';

interface VaultContextType {
  items: VaultItem[];
  folders: FolderItem[];
  isLoading: boolean;
  isSyncing: boolean;
  filterMode: FilterMode;
  setFilterMode: (mode: FilterMode) => void;
  selectedFolderId: string | null;
  setSelectedFolderId: (id: string | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  isFilterOpen: boolean;
  setIsFilterOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isFolderDropdownOpen: boolean;
  setIsFolderDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  createItem: (item: {
    name: string;
    username?: string;
    url?: string;
    password?: string;
    folderId?: string | null;
    isPrivateOnly?: boolean;
    itemType?: 'login' | 'card' | 'note';
    noteContent?: string;
  }) => Promise<boolean>;
  updateItem: (id: string, updates: Partial<VaultItem> & { password?: string }) => Promise<boolean>;
  batchMoveToFolder: (itemIds: string[], targetFolderId: string | null) => Promise<boolean>;
  deleteItem: (id: string) => Promise<boolean>;
  restoreItem: (id: string) => Promise<boolean>;
  purgeItem: (id: string) => Promise<boolean>;
  emptyTrash: () => Promise<boolean>;
  shareItemWithMember: (
    itemId: string,
    member: { id: string; name: string; email: string }
  ) => Promise<boolean>;
  revokeSharing: (itemId: string, memberId?: string) => Promise<boolean>;
  revealPassword: (item: VaultItem) => Promise<string>;
  refreshVault: () => Promise<void>;
  checkAllBreaches: () => Promise<{ checked: number; breached: number }>;
}

const VaultContext = createContext<VaultContextType | undefined>(undefined);

export const VaultProvider = ({ children }: { children: ReactNode }) => {
  const { user, appMode, masterPassword, unlockedPgpKey } = useAuth();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('passwords');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isFolderDropdownOpen, setIsFolderDropdownOpen] = useState(false);

  useEffect(() => {
    fetchVaultData();

    // Setup offline auto-sync when network returns
    const unsubscribeNet = setupOfflineAutoSync(() => {
      fetchVaultData(false);
    });

    // Unique channel per mount with proper cleanup
    const channelName = `public_sync_${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'resources' },
        () => {
          fetchVaultData(false);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'folders' },
        () => {
          fetchVaultData(false);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'resource_shares' },
        () => {
          fetchVaultData(false);
        }
      )
      .subscribe();

    return () => {
      unsubscribeNet();
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
  }, [appMode, user?.id]);

  const fetchVaultData = async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setIsSyncing(true);
    try {
      if (!user) {
        setItems([]);
        setFolders([]);
        return;
      }

      // 1. Fetch Folders (Only for this user or mode)
      const { data: folderRows } = await supabase
        .from('folders')
        .select('*')
        .eq('mode', appMode);

      if (folderRows && folderRows.length > 0) {
        setFolders(
          folderRows.map((f: any) => ({
            id: f.id,
            name: f.name || f.data?.name || 'Folder',
            description: f.description || f.data?.description,
            color: f.data?.color || f.color || '#FBBF24',
            itemCount: f.data?.itemCount || f.item_count || 0,
            lastModified: f.last_modified || f.data?.lastModified || f.created_at || 'Just now',
            mode: f.mode,
            isPrivateOnly: f.data?.isPrivateOnly,
          }))
        );
      } else {
        setFolders([]);
      }

      // 2. Fetch Resources owned by or shared with this user
      const { data: resourceRows, error } = await supabase
        .from('resources')
        .select('*')
        .eq('mode', appMode);

      // 3. Fetch resource shares for this user
      const { data: shareRows } = await supabase
        .from('resource_shares')
        .select('*')
        .eq('recipient_id', user.id);

      const sharedResourceIds = (shareRows || []).map((s: any) => s.resource_id);

      if (!error && resourceRows && resourceRows.length > 0) {
        const parsed: VaultItem[] = resourceRows
          .filter((r: any) => r.owner_id === user.id || r.data?.ownerId === user.id || sharedResourceIds.includes(r.id))
          .map((r: any) => {
            let d: any = {};
            if (r.data) {
              if (typeof r.data === 'string') {
                try {
                  d = JSON.parse(r.data);
                } catch {
                  d = {};
                }
              } else if (typeof r.data === 'object' && r.data !== null) {
                d = r.data;
              }
            }
            const isShared = sharedResourceIds.includes(r.id);
            const rawSecrets = Array.isArray(d.secrets) && d.secrets.length > 0
              ? d.secrets
              : Array.isArray(r.secrets) && r.secrets.length > 0
              ? r.secrets
              : d.encryptedData
              ? [{ userId: user.id, encryptedData: d.encryptedData }]
              : r.encrypted_data
              ? [{ userId: user.id, encryptedData: r.encrypted_data }]
              : [];

            const candidateSecret = d.encryptedData || d.encryptedPassword || r.encrypted_data || d.password || r.password || d.secret || r.secret;
            const finalSecrets = rawSecrets.length > 0
              ? rawSecrets
              : candidateSecret && typeof candidateSecret === 'string' && isEncryptedCipher(candidateSecret)
              ? [{ userId: user.id, encryptedData: candidateSecret }]
              : [];

            const rawName = d.name || r.name || d.title || r.title || d.label || r.label || 'Untitled Item';
            const rawUsername = d.username || r.username || d.user || r.user || d.email || r.email || '';
            const rawUrl = d.url || r.url || d.website || r.website || '';
            const rawPassword =
              d.decryptedPassword && !isEncryptedCipher(d.decryptedPassword)
                ? d.decryptedPassword
                : d.password && !isEncryptedCipher(d.password)
                ? d.password
                : undefined;
            const rawNote = d.noteContent || (d.itemType === 'note' && !isEncryptedCipher(d.decryptedPassword || d.password) ? (d.decryptedPassword || d.password) : undefined);

            return {
              ...d,
              id: r.id,
              name: rawName,
              username: rawUsername,
              url: rawUrl,
              folderId: r.folder_id || d.folderId || null,
              ownerId: r.owner_id || d.ownerId || user?.id,
              isPrivateOnly: !!(d.isPrivateOnly || r.item_type === 'card' || d.itemType === 'card'),
              score: typeof d.score === 'number' ? d.score : 80,
              strength: d.strength || 'Good',
              lastModified: d.lastModified || r.updated_at || 'Recently',
              isOld: !!d.isOld,
              isLeaked: !!d.isLeaked,
              secrets: finalSecrets,
              tags: Array.isArray(d.tags) ? d.tags : [],
              mode: r.mode || d.mode || appMode,
              decryptedPassword: rawPassword,
              noteContent: rawNote,
              itemType: r.item_type || d.itemType || (d.isPrivateOnly ? 'card' : 'login'),
              isDeleted: !!d.isDeleted,
              deletedAt: d.deletedAt,
              sharedWith: Array.isArray(d.sharedWith) ? d.sharedWith : (isShared ? [user.id] : []),
              sharedWithMembers: Array.isArray(d.sharedWithMembers) ? d.sharedWithMembers : [],
              ownerName: d.ownerName || r.owner_name,
              ownerEmail: d.ownerEmail || r.owner_email,
            };
          });

        const activeKey = unlockedPgpKey || (await AsyncStorage.getItem('clickrypt_unlocked_pgp_key'));
        const activePass = masterPassword || (await AsyncStorage.getItem('clickrypt_master_password'));

        const decryptedItems = await Promise.all(
          parsed.map(async (item) => {
            if (item.decryptedPassword && !isEncryptedCipher(item.decryptedPassword)) {
              return item;
            }
            const userSecret = resolveBestSecret(item, user.id, user.role, user.email);
            const rawBlob = userSecret?.encryptedData;
            if (rawBlob && typeof rawBlob === 'string' && (activeKey || activePass)) {
              try {
                const dec = await decryptSecret(rawBlob, activeKey || undefined, activePass || undefined);
                if (dec && !isEncryptedCipher(dec)) {
                  return { ...item, decryptedPassword: dec };
                }
              } catch {}
            }
            return item;
          })
        );

        setItems(decryptedItems);
        await AsyncStorage.setItem(`clickrypt_cached_vault_${appMode}`, JSON.stringify(decryptedItems));
      } else {
        const cached = await AsyncStorage.getItem(`clickrypt_cached_vault_${appMode}`);
        if (cached) {
          try {
            const parsedCached = JSON.parse(cached);
            if (Array.isArray(parsedCached)) {
              setItems(
                parsedCached.map((item: any) => ({
                  ...item,
                  name: item.name || item.title || 'Untitled Item',
                  username: item.username || item.user || '',
                  url: item.url || item.website || '',
                }))
              );
            } else {
              setItems([]);
            }
          } catch {
            setItems([]);
          }
        } else {
          setItems([]);
        }
      }
    } catch {
      setItems([]);
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
    }
  };

  const createItem = async (payload: {
    name: string;
    username?: string;
    url?: string;
    password?: string;
    folderId?: string | null;
    isPrivateOnly?: boolean;
    itemType?: 'login' | 'card' | 'note';
    noteContent?: string;
  }) => {
    try {
      if (!user) return false;
      const secretToEncrypt = payload.password || payload.noteContent || '';
      
      // 1. Generate random symmetric AES key for item
      const itemSymmetricKey = generateSymmetricKey();
      const encryptedBlob = await encryptSecret(secretToEncrypt, itemSymmetricKey);
      
      // 2. Encrypt item's symmetric key with owner's RSA public key
      const encryptedKeyForOwner = await encryptWithPublicKey(itemSymmetricKey, user.publicKey);
      
      // Check for data breach asynchronously (for passwords)
      let isBreached = false;
      if (payload.password && payload.itemType !== 'note') {
        const breachCheck = await checkPasswordBreach(payload.password);
        isBreached = breachCheck.isBreached;
      }

      const itemType = payload.itemType || (payload.isPrivateOnly ? 'card' : 'login');

      const newItem: VaultItem = {
        id: `res-${Date.now()}`,
        name: payload.name,
        username: payload.username || '',
        url: payload.url || '',
        folderId: payload.folderId || null,
        ownerId: user.id,
        ownerName: user.name,
        ownerEmail: user.email,
        isPrivateOnly: !!payload.isPrivateOnly || itemType === 'card',
        itemType,
        noteContent: payload.noteContent,
        isLeaked: isBreached,
        isDeleted: false,
        lastModified: new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        score: isBreached ? 20 : 90,
        strength: isBreached ? 'Weak' : 'Strong',
        secrets: [{ userId: user.id, encryptedData: encryptedBlob }],
        mode: appMode,
        decryptedPassword: secretToEncrypt,
      };

      const updated = [newItem, ...items];
      setItems(updated);
      await AsyncStorage.setItem(`clickrypt_cached_vault_${appMode}`, JSON.stringify(updated));

      const typeLabel =
        itemType === 'note'
          ? 'Secure Note Created'
          : itemType === 'card'
          ? 'Payment Card Stored'
          : 'Password Created';

      await logActivity(
        user.id,
        user.email,
        typeLabel,
        `Added "${newItem.name}" to ${appMode === 'organization' ? 'Organization' : 'Personal'} Vault`,
        'vault',
        appMode
      );

      // Attempt Supabase persist with clean JSONB payload
      try {
        const { error } = await supabase.from('resources').upsert({
          id: newItem.id,
          mode: appMode,
          data: {
            ...newItem,
            ownerId: user.id,
            folderId: payload.folderId || null,
            itemType,
            encryptedSymmetricKey: encryptedKeyForOwner,
          },
        });
        if (error) throw error;
      } catch {
        await queueMutation({
          action: 'UPSERT_RESOURCE',
          table: 'resources',
          recordId: newItem.id,
          data: {
            ...newItem,
            ownerId: user.id,
            folderId: payload.folderId || null,
            itemType,
            encryptedSymmetricKey: encryptedKeyForOwner,
          },
        });
      }

      return true;
    } catch {
      return false;
    }
  };

  const updateItem = async (id: string, updates: Partial<VaultItem> & { password?: string }) => {
    try {
      if (!user) return false;
      let encryptedBlob = '';
      let isBreached = false;

      const hasNewPassword = typeof updates.password === 'string' && updates.password.trim() !== '';
      const hasNewNote = typeof updates.noteContent === 'string' && updates.noteContent.trim() !== '';

      if (hasNewPassword || hasNewNote) {
        const secretToEncrypt = (hasNewPassword ? updates.password : updates.noteContent) || '';
        const itemSymmetricKey = generateSymmetricKey();
        encryptedBlob = await encryptSecret(secretToEncrypt, itemSymmetricKey);
        if (hasNewPassword && updates.password) {
          const breachCheck = await checkPasswordBreach(updates.password);
          isBreached = breachCheck.isBreached;
        }
      }

      const updated = items.map((item) => {
        if (item.id !== id) return item;
        const newSecrets = (hasNewPassword || hasNewNote)
          ? [{ userId: user.id, encryptedData: encryptedBlob }]
          : item.secrets;
        const newDecrypted = hasNewPassword
          ? updates.password
          : hasNewNote
          ? updates.noteContent
          : item.decryptedPassword;
        return {
          ...item,
          ...updates,
          decryptedPassword: newDecrypted,
          noteContent: hasNewNote ? updates.noteContent : item.noteContent,
          isLeaked: hasNewPassword ? isBreached : item.isLeaked,
          secrets: newSecrets,
          lastModified: new Date().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        };
      });

      setItems(updated);
      await AsyncStorage.setItem(`clickrypt_cached_vault_${appMode}`, JSON.stringify(updated));

      const target = updated.find((i) => i.id === id);
      if (target) {
        await logActivity(
          user.id,
          user.email,
          'Vault Item Updated',
          `Updated "${target.name}" in vault`,
          'vault',
          appMode
        );

        try {
          const { error } = await supabase.from('resources').upsert({
            id: target.id,
            mode: appMode,
            data: { ...target },
          });
          if (error) throw error;
        } catch {
          await queueMutation({
            action: 'UPSERT_RESOURCE',
            table: 'resources',
            recordId: target.id,
            data: { ...target },
          });
        }
      }

      return true;
    } catch {
      return false;
    }
  };

  const batchMoveToFolder = async (itemIds: string[], targetFolderId: string | null) => {
    try {
      if (!user) return false;
      const updated = items.map((item) =>
        itemIds.includes(item.id)
          ? {
              ...item,
              folderId: targetFolderId,
              lastModified: new Date().toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }),
            }
          : item
      );
      setItems(updated);
      await AsyncStorage.setItem(`clickrypt_cached_vault_${appMode}`, JSON.stringify(updated));

      const folderName = targetFolderId
        ? folders.find((f) => f.id === targetFolderId)?.name || 'Folder'
        : 'Root Vault (No Folder)';

      await logActivity(
        user.id,
        user.email,
        'Bulk Moved to Folder',
        `Moved ${itemIds.length} item(s) to "${folderName}"`,
        'folder',
        appMode
      );

      for (const id of itemIds) {
        const target = updated.find((i) => i.id === id);
        if (target) {
          try {
            await supabase.from('resources').upsert({
              id: target.id,
              mode: appMode,
              data: { ...target },
            });
          } catch {
            await queueMutation({
              action: 'UPSERT_RESOURCE',
              table: 'resources',
              recordId: target.id,
              data: { ...target },
            });
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  };

  const deleteItem = async (id: string) => {
    try {
      if (!user) return false;
      const itemToDelete = items.find((i) => i.id === id);
      const updated = items.map((i) =>
        i.id === id ? { ...i, isDeleted: true, deletedAt: new Date().toISOString() } : i
      );
      setItems(updated);
      await AsyncStorage.setItem(`clickrypt_cached_vault_${appMode}`, JSON.stringify(updated));

      if (itemToDelete) {
        await logActivity(
          user.id,
          user.email,
          'Moved to Trash',
          `Moved "${itemToDelete.name}" to Trash / Recycle Bin`,
          'vault',
          appMode
        );
      }

      const target = updated.find((i) => i.id === id);
      if (target) {
        try {
          await supabase.from('resources').upsert({
            id: target.id,
            mode: appMode,
            data: { ...target },
          });
        } catch {
          await queueMutation({
            action: 'UPSERT_RESOURCE',
            table: 'resources',
            recordId: target.id,
            data: { ...target },
          });
        }
      }

      return true;
    } catch {
      return false;
    }
  };

  const restoreItem = async (id: string) => {
    try {
      if (!user) return false;
      const itemToRestore = items.find((i) => i.id === id);
      const updated = items.map((i) =>
        i.id === id ? { ...i, isDeleted: false, deletedAt: undefined } : i
      );
      setItems(updated);
      await AsyncStorage.setItem(`clickrypt_cached_vault_${appMode}`, JSON.stringify(updated));

      if (itemToRestore) {
        await logActivity(
          user.id,
          user.email,
          'Restored from Trash',
          `Restored "${itemToRestore.name}" from trash`,
          'vault',
          appMode
        );
      }

      const target = updated.find((i) => i.id === id);
      if (target) {
        try {
          await supabase.from('resources').upsert({
            id: target.id,
            mode: appMode,
            data: { ...target },
          });
        } catch {
          await queueMutation({
            action: 'UPSERT_RESOURCE',
            table: 'resources',
            recordId: target.id,
            data: { ...target },
          });
        }
      }

      return true;
    } catch {
      return false;
    }
  };

  const purgeItem = async (id: string) => {
    try {
      if (!user) return false;
      const itemToPurge = items.find((i) => i.id === id);
      const filtered = items.filter((i) => i.id !== id);
      setItems(filtered);
      await AsyncStorage.setItem(`clickrypt_cached_vault_${appMode}`, JSON.stringify(filtered));

      if (itemToPurge) {
        await logActivity(
          user.id,
          user.email,
          'Permanently Deleted',
          `Permanently deleted "${itemToPurge.name}" from trash`,
          'vault',
          appMode
        );
      }

      try {
        const { error } = await supabase.from('resources').delete().eq('id', id);
        if (error) throw error;
      } catch {
        await queueMutation({
          action: 'DELETE_RESOURCE',
          table: 'resources',
          recordId: id,
        });
      }

      return true;
    } catch {
      return false;
    }
  };

  const emptyTrash = async () => {
    try {
      if (!user) return false;
      const deletedItems = items.filter((i) => i.isDeleted);
      const activeOnly = items.filter((i) => !i.isDeleted);
      setItems(activeOnly);
      await AsyncStorage.setItem(`clickrypt_cached_vault_${appMode}`, JSON.stringify(activeOnly));

      await logActivity(
        user.id,
        user.email,
        'Trash Emptied',
        `Permanently purged ${deletedItems.length} item(s) from trash`,
        'vault',
        appMode
      );

      for (const item of deletedItems) {
        try {
          await supabase.from('resources').delete().eq('id', item.id);
        } catch {
          await queueMutation({
            action: 'DELETE_RESOURCE',
            table: 'resources',
            recordId: item.id,
          });
        }
      }
      return true;
    } catch {
      return false;
    }
  };

  const revealPassword = async (item: VaultItem): Promise<string> => {
    if (!user) return '';

    // Helper to log and cache decrypted password in state without mutating item in-place
    const commitDecrypted = async (val: string) => {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, decryptedPassword: val } : i))
      );
      try {
        logActivity(
          user.id,
          user.email,
          'Password Decrypted',
          `Decrypted credentials for "${item.name || 'Vault Item'}"`,
          'vault',
          appMode
        ).catch(() => {});
      } catch {
        // ignore
      }
      return val;
    };

    // 1. Direct memory/stored decrypted password if present, clean, and valid
    if (
      item.decryptedPassword &&
      !isEncryptedCipher(item.decryptedPassword) &&
      item.decryptedPassword !== '•••••••' &&
      item.decryptedPassword !== '••••••••'
    ) {
      return commitDecrypted(item.decryptedPassword);
    }

    const activeKey = unlockedPgpKey || (await AsyncStorage.getItem('clickrypt_unlocked_pgp_key'));
    const activePass = masterPassword || (await AsyncStorage.getItem('clickrypt_master_password'));

    // 2. Try decrypting from secrets array using canonical secret resolver
    const userSecret = resolveBestSecret(item, user.id, user.role, user.email);
    const rawBlob =
      userSecret?.encryptedData ||
      (item.decryptedPassword && isEncryptedCipher(item.decryptedPassword) ? item.decryptedPassword : null) ||
      item.secrets?.find((s) => s.userId === user.id)?.encryptedData ||
      item.secrets?.[0]?.encryptedData ||
      (item as any).secrets?.[0]?.encrypted_data ||
      (item as any).encryptedData ||
      (item as any).encryptedPassword ||
      (item as any).data?.encryptedPassword ||
      (item as any).data?.password ||
      (item as any).password;

    if (rawBlob && typeof rawBlob === 'string') {
      try {
        const decrypted = await decryptSecret(
          rawBlob,
          activeKey || user.encryptedPrivateKey,
          activePass || undefined
        );

        if (
          decrypted &&
          decrypted.trim() &&
          !isEncryptedCipher(decrypted) &&
          decrypted !== '•••••••' &&
          decrypted !== '••••••••'
        ) {
          return await commitDecrypted(decrypted);
        }
      } catch {
        // continue
      }
    }

    // 3. Try decrypting from resource_shares if shared with user
    try {
      const { data: shareData } = await supabase
        .from('resource_shares')
        .select('*')
        .eq('resource_id', item.id)
        .eq('recipient_id', user.id)
        .maybeSingle();

      if (shareData?.encrypted_symmetric_key) {
        const decryptedSymKey = await decryptWithPrivateKey(
          shareData.encrypted_symmetric_key,
          unlockedPgpKey || user.encryptedPrivateKey,
          masterPassword || undefined
        );
        const decrypted = rawBlob
          ? await decryptSecret(rawBlob, decryptedSymKey, masterPassword || undefined)
          : decryptedSymKey;

        if (
          decrypted &&
          decrypted.trim() &&
          !isEncryptedCipher(decrypted) &&
          decrypted !== '•••••••' &&
          decrypted !== '••••••••'
        ) {
          return await commitDecrypted(decrypted);
        }
      }
    } catch {
      // continue
    }

    // 4. If note content exists, return it
    if (item.noteContent && !isEncryptedCipher(item.noteContent)) {
      return await commitDecrypted(item.noteContent);
    }

    if (item.decryptedPassword && !isEncryptedCipher(item.decryptedPassword)) {
      return item.decryptedPassword;
    }

    const fallbackVal =
      (item as any).password ||
      (item as any).data?.password ||
      item.decryptedPassword ||
      '';
    return await commitDecrypted(fallbackVal);
  };

  const shareItemWithMember = async (
    itemId: string,
    member: { id: string; name: string; email: string }
  ): Promise<boolean> => {
    try {
      if (!user) return false;
      const target = items.find((i) => i.id === itemId);
      if (!target) return false;

      // 1. Fetch recipient's RSA public key from database
      const { data: recipientProfile } = await supabase
        .from('users')
        .select('*')
        .eq('id', member.id)
        .maybeSingle();

      const recipientPubKey =
        recipientProfile?.public_key ||
        recipientProfile?.data?.publicKey ||
        (member as any).publicKey;

      // 2. Generate or extract symmetric key, and re-encrypt with recipient's public key
      const revealedSecret = await revealPassword(target);
      const reEncryptedKey = await encryptWithPublicKey(revealedSecret, recipientPubKey);

      // 3. Upsert into resource_shares table (Zero-Knowledge Asymmetric Share)
      try {
        await supabase.from('resource_shares').upsert({
          id: `sh-${target.id}-${member.id}`,
          resource_id: target.id,
          recipient_id: member.id,
          encrypted_symmetric_key: reEncryptedKey,
          shared_by: user.id,
          permission: 'read',
          shared_at: new Date().toISOString(),
        });
      } catch {
        // queued if offline
      }

      const currentShared = target.sharedWith || [];
      const updatedShared = currentShared.includes(member.id)
        ? currentShared
        : [...currentShared, member.id];

      const currentMembers = target.sharedWithMembers || [];
      const existingMember = currentMembers.find((m) => m.id === member.id);
      const updatedMembers = existingMember
        ? currentMembers
        : [
            ...currentMembers,
            {
              id: member.id,
              name: member.name,
              email: member.email,
              sharedAt: new Date().toLocaleDateString(),
            },
          ];

      await logActivity(
        user.id,
        user.email,
        'Item Shared with Team',
        `Shared "${target.name}" with ${member.name} (${member.email})`,
        'share',
        appMode
      );

      return await updateItem(itemId, {
        sharedWith: updatedShared,
        sharedWithMembers: updatedMembers,
        isExternalShared: true,
      });
    } catch {
      return false;
    }
  };

  const revokeSharing = async (itemId: string, memberId?: string): Promise<boolean> => {
    try {
      if (!user) return false;
      const target = items.find((i) => i.id === itemId);
      if (!target) return false;

      // Delete from resource_shares table
      try {
        if (memberId) {
          await supabase
            .from('resource_shares')
            .delete()
            .eq('resource_id', itemId)
            .eq('recipient_id', memberId);
        } else {
          await supabase
            .from('resource_shares')
            .delete()
            .eq('resource_id', itemId);
        }
      } catch {
        // ignore
      }

      if (memberId) {
        const updatedShared = (target.sharedWith || []).filter((id) => id !== memberId);
        const updatedMembers = (target.sharedWithMembers || []).filter((m) => m.id !== memberId);
        return await updateItem(itemId, {
          sharedWith: updatedShared,
          sharedWithMembers: updatedMembers,
          isExternalShared: updatedShared.length > 0,
        });
      } else {
        // Revoke all shares
        return await updateItem(itemId, {
          sharedWith: [],
          sharedWithMembers: [],
          isExternalShared: false,
        });
      }
    } catch {
      return false;
    }
  };

  const checkAllBreaches = async (): Promise<{ checked: number; breached: number }> => {
    let breached = 0;
    const updatedItems = [...items];

    for (let i = 0; i < updatedItems.length; i++) {
      const item = updatedItems[i];
      if (item.isPrivateOnly) continue;
      const secret = await revealPassword(item);
      const res = await checkPasswordBreach(secret);
      if (res.isBreached) {
        breached++;
        updatedItems[i] = { ...item, isLeaked: true, score: 20, strength: 'Weak' };
      }
    }

    setItems(updatedItems);
    await AsyncStorage.setItem(`clickrypt_cached_vault_${appMode}`, JSON.stringify(updatedItems));
    return { checked: items.length, breached };
  };

  return (
    <VaultContext.Provider
      value={{
        items,
        folders,
        isLoading,
        isSyncing,
        filterMode,
        setFilterMode,
        selectedFolderId,
        setSelectedFolderId,
        searchQuery,
        setSearchQuery,
        activeTab,
        setActiveTab,
        isFilterOpen,
        setIsFilterOpen,
        isFolderDropdownOpen,
        setIsFolderDropdownOpen,
        createItem,
        updateItem,
        batchMoveToFolder,
        deleteItem,
        restoreItem,
        purgeItem,
        emptyTrash,
        shareItemWithMember,
        revokeSharing,
        revealPassword,
        refreshVault: () => fetchVaultData(true),
        checkAllBreaches,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
};

export const useVault = () => {
  const context = useContext(VaultContext);
  if (!context) throw new Error('useVault must be used within VaultProvider');
  return context;
};
