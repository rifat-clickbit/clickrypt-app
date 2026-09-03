import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabaseClient';
import { setupOfflineAutoSync } from '../services/offlineQueue';
import { useAuth } from './AuthContext';
import { VaultItem, FolderItem, UserProfile } from '../types';
import {
  encryptSecret,
  decryptSecret,
  generateSymmetricKey,
  encryptWithPublicKey,
  decryptWithPrivateKey,
  isEncryptedCipher,
  resolveBestSecret,
  getUnlockedPrivateKey,
  VaultLockedError,
  DecryptionFailedError,
  isDecryptionKeyAvailable,
  getSessionUnlockedKey,
} from '../crypto/cryptoEngine';
import { checkPasswordBreach } from '../services/breachScanner';
import { queueMutation } from '../services/offlineQueue';
import { withTimeout } from '../utils/withTimeout';
import { logActivity } from '../services/activityLogService';
import { fetchVaultDirect } from '../services/vaultFetcher';

type AppMode = 'personal' | 'organization';

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

type TabType = 'passwords' | 'cards' | 'folders' | 'team' | 'settings';

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
  updateItem: (
    id: string,
    updates: Partial<VaultItem> & { password?: string }
  ) => Promise<boolean>;
  batchMoveToFolder: (
    itemIds: string[],
    targetFolderId: string | null
  ) => Promise<boolean>;
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

const persistableItem = (item: VaultItem): any => {
  // Strip all plaintext/decrypted fields so they never get persisted to the DB.
  // `password` leaks in via updateItem's `...updates` spread.
  const { decryptedPassword, noteContent, password, ...rest } = item as any;
  return rest;
};

const loadCachedVault = async (appMode: AppMode): Promise<VaultItem[]> => {
  try {
    const cached = await AsyncStorage.getItem(
      `clickrypt_cached_vault_${appMode}`
    );
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[Vault] load cached failed', e);
  }
  return [];
};

export const VaultProvider = ({ children }: { children: ReactNode }) => {
  const {
    user,
    appMode,
    credentialsResolved,
  } = useAuth();

  const [items, setItems] = useState<VaultItem[]>([]);
  const [rawItems, setRawItems] = useState<VaultItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('passwords');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isFolderDropdownOpen, setIsFolderDropdownOpen] = useState(false);

  const isFetchingRef = useRef(false);
  const pendingFetchRef = useRef(false);
  const subscribedRef = useRef<string | null>(null);
  const initialSyncRef = useRef<string | null>(null);
  const lastRawKeyRef = useRef<string>('');

  // Keep the latest user in a ref so fetchVaultData can stay identity-stable.
  // AuthContext replaces the user OBJECT on every profile rehydration even
  // though user.id is the same; keying callbacks on the object identity made
  // every rehydration tear down realtime subscriptions and re-run the full
  // initial sync (the "permanently syncing..." churn).
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const itemsRef = useRef<VaultItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const invalidateVaultCache = useCallback(async () => {
    if (!user) return;
    await withTimeout(
      supabase.functions.invoke('vault-cache-invalidate', { body: { appMode } }),
      10000,
      'vault-cache-invalidate'
    ).catch(() => {});
  }, [user, appMode]);

  // Load cached items immediately for instant UI availability
  useEffect(() => {
    let isMounted = true;
    (async () => {
      const cached = await loadCachedVault(appMode);
      if (isMounted && cached.length > 0) {
        itemsRef.current = cached;
        setItems(cached);
        setRawItems(cached);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [appMode]);

  const fetchVaultData = useCallback(
    async (showLoading: boolean) => {
      if (isFetchingRef.current) {
        pendingFetchRef.current = true;
        return;
      }

      isFetchingRef.current = true;
      pendingFetchRef.current = false;

      // Only show full loading spinner if there are NO items in memory/cache
      if (showLoading && itemsRef.current.length === 0) {
        setIsLoading(true);
      }
      setIsSyncing(true);

      try {
        const currentUser = userRef.current;
        if (!currentUser?.id) {
          const cached = await loadCachedVault(appMode);
          setItems(cached);
          setRawItems(cached);
          return;
        }

        let fetchedItems: VaultItem[] | null = null;
        let fetchedFolders: FolderItem[] | null = null;

        // 1. Try edge function cache first
        try {
          const { data, error } = await withTimeout(
            supabase.functions.invoke('vault-cache', {
              body: { appMode },
            }),
            12000,
            'vault-cache'
          );

          if (!error && data?.items) {
            fetchedItems = data.items || [];
            fetchedFolders = data.folders || [];
          }
        } catch (edgeErr) {
          console.warn(`[Vault] vault-cache edge function notice for ${currentUser.id}:`, edgeErr);
        }

        // 2. Direct Supabase fallback query if edge function missed or failed
        if (!fetchedItems) {
          try {
            const direct = await withTimeout(
              fetchVaultDirect(supabase, currentUser, appMode),
              12000,
              'vault-fetch-direct'
            );
            if (direct && direct.items) {
              fetchedItems = direct.items;
              fetchedFolders = direct.folders;
            }
          } catch (directErr) {
            console.warn('[Vault] direct fallback notice:', directErr);
          }
        }

        if (fetchedItems) {
          setFolders(fetchedFolders || []);
          setRawItems(fetchedItems);
          // Preserve any in-memory decrypted passwords so background sync does not clear revealed items
          setItems((prevItems) => {
            const revealedMap = new Map(
              prevItems
                .filter((i) => i.decryptedPassword && !isEncryptedCipher(i.decryptedPassword))
                .map((i) => [i.id, i.decryptedPassword])
            );
            return fetchedItems.map((item) => {
              const cachedPass = revealedMap.get(item.id);
              return cachedPass ? { ...item, decryptedPassword: cachedPass } : item;
            });
          });
          await AsyncStorage.setItem(
            `clickrypt_cached_vault_${appMode}`,
            JSON.stringify(fetchedItems)
          );
        } else {
          // 3. Fall back to local AsyncStorage cache
          const cached = await loadCachedVault(appMode);
          if (cached.length > 0) {
            setItems(cached);
            setRawItems(cached);
          }
        }
      } catch (err) {
        console.warn('[Vault] fetchVaultData error:', err);
      } finally {
        isFetchingRef.current = false;
        setIsLoading(false);
        setIsSyncing(false);

        if (pendingFetchRef.current) {
          pendingFetchRef.current = false;
          // Run one debounced follow-up fetch if mutations arrived during sync
          setTimeout(() => {
            if (userRef.current?.id) {
              fetchVaultData(false);
            }
          }, 1000);
        }
      }
    },
    [appMode]
  );

  // Network sync, realtime subscriptions, and offline auto-sync
  useEffect(() => {
    const currentUserId = user?.id;
    const syncKey = `${appMode}-${currentUserId || 'anon'}`;

    if (!currentUserId) {
      loadCachedVault(appMode).then((cached) => {
        if (cached.length > 0) {
          setItems(cached);
          setRawItems(cached);
        }
      });
      return;
    }

    // Initial sync for this user and appMode
    if (initialSyncRef.current !== syncKey) {
      initialSyncRef.current = syncKey;
      fetchVaultData(true);
    }

    let syncTimeout: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (syncTimeout) clearTimeout(syncTimeout);
      syncTimeout = setTimeout(() => {
        if (userRef.current?.id) {
          fetchVaultData(false);
        }
      }, 1500);
    };

    const unsubscribeNet = setupOfflineAutoSync(debouncedFetch);

    // Prevent duplicate channel subscriptions
    if (subscribedRef.current === syncKey) {
      return () => {
        if (syncTimeout) clearTimeout(syncTimeout);
        unsubscribeNet();
      };
    }
    subscribedRef.current = syncKey;

    const channelName = `vault_sync_${syncKey}_${Date.now()}`;
    const ownerFilter = `owner_id=eq.${currentUserId}`;
    const recipientFilter = `recipient_id=eq.${currentUserId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'resources', filter: ownerFilter },
        debouncedFetch
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'folders', filter: ownerFilter },
        debouncedFetch
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'resource_shares', filter: recipientFilter },
        debouncedFetch
      )
      .subscribe();

    return () => {
      if (syncTimeout) clearTimeout(syncTimeout);
      unsubscribeNet();
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
      subscribedRef.current = null;
      initialSyncRef.current = null;
    };
  }, [appMode, fetchVaultData, user?.id]);

  const createItem = useCallback(
    async (payload: {
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
        const itemSymmetricKey = generateSymmetricKey();
        const encryptedBlob = await encryptSecret(secretToEncrypt, itemSymmetricKey);
        const encryptedKeyForOwner = await encryptWithPublicKey(
          itemSymmetricKey,
          user.publicKey
        );

        // Pre-save validation: ensure both encryption steps produced valid
        // PGP armored ciphertext. If either failed (e.g. due to a library
        // API mismatch), throw instead of silently persisting broken data
        // that can never be decrypted later.
        if (secretToEncrypt &&
            (!encryptedBlob || !encryptedBlob.includes('-----BEGIN PGP MESSAGE-----') ||
             !encryptedKeyForOwner || !encryptedKeyForOwner.includes('-----BEGIN PGP MESSAGE-----'))) {
          console.error('[Vault] addItem: encryption validation failed', {
            hasBlob: !!encryptedBlob,
            hasWrappedKey: !!encryptedKeyForOwner,
          });
          throw new Error('Failed to encrypt item: encryption produced invalid ciphertext. Item was not saved.');
        }

        let isBreached = false;
        if (payload.password && payload.itemType !== 'note') {
          const breachCheck = await checkPasswordBreach(payload.password);
          isBreached = breachCheck.isBreached;
        }

        const itemType =
          payload.itemType || (payload.isPrivateOnly ? 'card' : 'login');

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
          encryptedSymmetricKey: encryptedKeyForOwner,
          mode: appMode,
          decryptedPassword: secretToEncrypt,
        };

        const updated = [newItem, ...items];
        setItems(updated);
        await AsyncStorage.setItem(
          `clickrypt_cached_vault_${appMode}`,
          JSON.stringify(updated)
        );

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
          `Added "${newItem.name}" to ${
            appMode === 'organization' ? 'Organization' : 'Personal'
          } Vault`,
          'vault',
          appMode
        );

        try {
          const { error } = await supabase.from('resources').upsert({
            id: newItem.id,
            name: newItem.name,
            category: newItem.itemType || 'login',
            mode: appMode,
            owner_id: user.id,
            folder_id: payload.folderId || null,
            secrets_data: newItem.secrets,
            data: {
              ...persistableItem(newItem),
              encryptedSymmetricKey: encryptedKeyForOwner,
            },
          });
          if (error) throw error;
        } catch {
          await queueMutation({
            action: 'UPSERT_RESOURCE',
            table: 'resources',
            recordId: newItem.id,
            columns: {
              owner_id: user.id,
              folder_id: payload.folderId || null,
            },
            data: {
              ...persistableItem(newItem),
              ownerId: user.id,
              folderId: payload.folderId || null,
              itemType,
              encryptedSymmetricKey: encryptedKeyForOwner,
            },
          });
        }

        invalidateVaultCache();
        return true;
      } catch {
        return false;
      }
    },
    [appMode, invalidateVaultCache, items, user]
  );

  const updateItem = useCallback(
    async (id: string, updates: Partial<VaultItem> & { password?: string }) => {
      try {
        if (!user) return false;

        let encryptedBlob = '';
        let encryptedKeyForOwner = '';
        let itemSymmetricKey = '';
        let isBreached = false;

        const hasNewPassword =
          typeof updates.password === 'string' &&
          updates.password.trim() !== '';
        const hasNewNote =
          typeof updates.noteContent === 'string' &&
          updates.noteContent.trim() !== '';

        if (hasNewPassword || hasNewNote) {
          const secretToEncrypt = (hasNewPassword
            ? updates.password
            : updates.noteContent) as string;
          itemSymmetricKey = generateSymmetricKey();
          encryptedBlob = await encryptSecret(secretToEncrypt, itemSymmetricKey);
          encryptedKeyForOwner = await encryptWithPublicKey(
            itemSymmetricKey,
            user.publicKey
          );
          // Pre-save validation: ensure both encryption steps produced valid
          // PGP armored ciphertext. Prevents silently persisting broken data.
          if (!encryptedBlob || !encryptedBlob.includes('-----BEGIN PGP MESSAGE-----') ||
              !encryptedKeyForOwner || !encryptedKeyForOwner.includes('-----BEGIN PGP MESSAGE-----')) {
            console.error('[Vault] updateItem: encryption validation failed', {
              hasBlob: !!encryptedBlob,
              hasWrappedKey: !!encryptedKeyForOwner,
            });
            throw new Error('Failed to encrypt item: encryption produced invalid ciphertext. Item was not updated.');
          }
          if (hasNewPassword && updates.password) {
            const breachCheck = await checkPasswordBreach(updates.password);
            isBreached = breachCheck.isBreached;
          }
        }

        const updated = items.map((item) => {
          if (item.id !== id) return item;
          const newSecrets =
            hasNewPassword || hasNewNote
              ? [{ userId: user.id, encryptedData: encryptedBlob }]
              : item.secrets;
          const newDecrypted = hasNewPassword
            ? updates.password
            : hasNewNote
            ? updates.noteContent
            : item.decryptedPassword;
          const newEncryptedSymmetricKey =
            hasNewPassword || hasNewNote
              ? encryptedKeyForOwner
              : item.encryptedSymmetricKey;
          return {
            ...item,
            ...updates,
            decryptedPassword: newDecrypted,
            noteContent: hasNewNote ? updates.noteContent : item.noteContent,
            isLeaked: hasNewPassword ? isBreached : item.isLeaked,
            secrets: newSecrets,
            encryptedSymmetricKey: newEncryptedSymmetricKey,
            lastModified: new Date().toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }),
          } as VaultItem;
        });

        setItems(updated);
        await AsyncStorage.setItem(
          `clickrypt_cached_vault_${appMode}`,
          JSON.stringify(updated)
        );

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

          // If the item is shared and the secret changed, re-wrap the new
          // symmetric key for each existing recipient so they can still decrypt.
          if (
            (hasNewPassword || hasNewNote) &&
            itemSymmetricKey &&
            target.sharedWith?.length
          ) {
            try {
              const { data: recipientProfiles } = await supabase
                .from('users')
                .select('id, public_key, data')
                .in('id', target.sharedWith.filter(Boolean));

              if (recipientProfiles && recipientProfiles.length > 0) {
                await Promise.all(
                  recipientProfiles.map(async (r: any) => {
                    const recipientId = r.id;
                    const recipientPubKey: string | null =
                      r.public_key || r.data?.publicKey;
                    if (!recipientPubKey || !recipientId) return;

                    const reEncryptedKey = await encryptWithPublicKey(
                      itemSymmetricKey,
                      recipientPubKey
                    );

                    await supabase.from('resource_shares').upsert({
                      id: `sh-${target.id}-${recipientId}`,
                      resource_id: target.id,
                      recipient_id: recipientId,
                      shared_by: user.id,
                      encrypted_symmetric_key: reEncryptedKey,
                      permission: 'read',
                      shared_at: new Date().toISOString(),
                    });
                  })
                );
              }
            } catch (err: any) {
              console.warn(
                '[Vault] updateItem: failed to re-wrap shares for item',
                target.id,
                err?.message || err
              );
            }
          }

          try {
            const { error } = await supabase.from('resources').upsert({
              id: target.id,
              name: target.name,
              category: target.itemType || 'login',
              mode: appMode,
              owner_id: target.ownerId || user.id,
              folder_id: target.folderId ?? null,
              secrets_data: target.secrets,
              last_modified: target.lastModified,
              data: persistableItem(target),
            });
            if (error) throw error;
          } catch {
            await queueMutation({
              action: 'UPSERT_RESOURCE',
              table: 'resources',
              recordId: target.id,
              columns: {
                owner_id: target.ownerId || user.id,
                folder_id: target.folderId ?? null,
              },
              data: persistableItem(target),
            });
          }
        }

        invalidateVaultCache();
        return true;
      } catch {
        return false;
      }
    },
    [appMode, invalidateVaultCache, items, user]
  );

  const batchMoveToFolder = useCallback(
    async (itemIds: string[], targetFolderId: string | null) => {
      try {
        if (!user) return false;

        const updated = items.map((item) =>
          itemIds.includes(item.id)
            ? ({
                ...item,
                folderId: targetFolderId,
                lastModified: new Date().toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              } as VaultItem)
            : item
        );
        setItems(updated);
        await AsyncStorage.setItem(
          `clickrypt_cached_vault_${appMode}`,
          JSON.stringify(updated)
        );

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
                owner_id: target.ownerId || user.id,
                folder_id: target.folderId ?? null,
                data: persistableItem(target),
              });
            } catch {
              await queueMutation({
                action: 'UPSERT_RESOURCE',
                table: 'resources',
                recordId: target.id,
                columns: {
                  owner_id: target.ownerId || user.id,
                  folder_id: target.folderId ?? null,
                },
                data: persistableItem(target),
              });
            }
          }
        }

        invalidateVaultCache();
        return true;
      } catch {
        return false;
      }
    },
    [appMode, folders, invalidateVaultCache, items, user]
  );

  const deleteItem = useCallback(
    async (id: string) => {
      try {
        if (!user) return false;

        const itemToDelete = items.find((i) => i.id === id);
        const updated = items.map((i) =>
          i.id === id
            ? ({ ...i, isDeleted: true, deletedAt: new Date().toISOString() } as VaultItem)
            : i
        );
        setItems(updated);
        await AsyncStorage.setItem(
          `clickrypt_cached_vault_${appMode}`,
          JSON.stringify(updated)
        );

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
              owner_id: target.ownerId || user.id,
              folder_id: target.folderId ?? null,
              data: persistableItem(target),
            });
          } catch {
            await queueMutation({
              action: 'UPSERT_RESOURCE',
              table: 'resources',
              recordId: target.id,
              columns: {
                owner_id: target.ownerId || user.id,
                folder_id: target.folderId ?? null,
              },
              data: persistableItem(target),
            });
          }
        }

        invalidateVaultCache();
        return true;
      } catch {
        return false;
      }
    },
    [appMode, invalidateVaultCache, items, user]
  );

  const restoreItem = useCallback(
    async (id: string) => {
      try {
        if (!user) return false;

        const itemToRestore = items.find((i) => i.id === id);
        const updated = items.map((i) =>
          i.id === id
            ? ({ ...i, isDeleted: false, deletedAt: undefined } as VaultItem)
            : i
        );
        setItems(updated);
        await AsyncStorage.setItem(
          `clickrypt_cached_vault_${appMode}`,
          JSON.stringify(updated)
        );

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
              owner_id: target.ownerId || user.id,
              folder_id: target.folderId ?? null,
              data: persistableItem(target),
            });
          } catch {
            await queueMutation({
              action: 'UPSERT_RESOURCE',
              table: 'resources',
              recordId: target.id,
              columns: {
                owner_id: target.ownerId || user.id,
                folder_id: target.folderId ?? null,
              },
              data: persistableItem(target),
            });
          }
        }

        invalidateVaultCache();
        return true;
      } catch {
        return false;
      }
    },
    [appMode, invalidateVaultCache, items, user]
  );

  const purgeItem = useCallback(
    async (id: string) => {
      try {
        if (!user) return false;

        const itemToPurge = items.find((i) => i.id === id);
        const filtered = items.filter((i) => i.id !== id);
        setItems(filtered);
        await AsyncStorage.setItem(
          `clickrypt_cached_vault_${appMode}`,
          JSON.stringify(filtered)
        );

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

        invalidateVaultCache();
        return true;
      } catch {
        return false;
      }
    },
    [appMode, invalidateVaultCache, items, user]
  );

  const emptyTrash = useCallback(async () => {
    try {
      if (!user) return false;

      const deletedItems = items.filter((i) => i.isDeleted);
      const activeOnly = items.filter((i) => !i.isDeleted);
      setItems(activeOnly);
      await AsyncStorage.setItem(
        `clickrypt_cached_vault_${appMode}`,
        JSON.stringify(activeOnly)
      );

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

      invalidateVaultCache();
      return true;
    } catch {
      return false;
    }
  }, [appMode, invalidateVaultCache, items, user]);

  const revealPassword = useCallback(
    async (item: VaultItem) => {
      if (!user) {
        console.warn('[Vault] revealPassword: no user');
        throw new DecryptionFailedError('No authenticated user available to decrypt this item.');
      }

      const commitDecrypted = async (val: string) => {
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, decryptedPassword: val } : i
          )
        );
        logActivity(
          user.id,
          user.email,
          'Password Decrypted',
          `Decrypted credentials for "${item.name || 'Vault Item'}"`,
          'vault',
          appMode
        ).catch(() => {});
        return val;
      };

      if (
        item.decryptedPassword &&
        !isEncryptedCipher(item.decryptedPassword) &&
        item.decryptedPassword !== '•••••••' &&
        item.decryptedPassword !== '••••••••'
      ) {
        return commitDecrypted(item.decryptedPassword);
      }

      const activeKey = getSessionUnlockedKey();
      if (!activeKey || !isDecryptionKeyAvailable(activeKey)) {
        console.warn('[Vault] revealPassword: no in-memory session key available for item', item.id);
        throw new VaultLockedError();
      }

      const userSecret = resolveBestSecret(
        item,
        user.id,
        user.role,
        user.email
      );
      const rawBlob: any =
        userSecret?.encryptedData ||
        (item.decryptedPassword &&
        isEncryptedCipher(item.decryptedPassword)
          ? item.decryptedPassword
          : null) ||
        item.secrets?.find((s) => s.userId === user.id)?.encryptedData ||
        item.secrets?.[0]?.encryptedData ||
        (item as any).secrets?.[0]?.encrypted_data ||
        (item as any).encryptedData ||
        (item as any).encryptedPassword ||
        (item as any).data?.encryptedPassword ||
        (item as any).data?.password ||
        (item as any).password;

      const encSymKey: any =
        item.encryptedSymmetricKey ||
        (item as any).encrypted_symmetric_key ||
        (item as any).data?.encryptedSymmetricKey;

      if (encSymKey && activeKey) {
        try {
          const unwrappedKey = await decryptWithPrivateKey(
            encSymKey,
            activeKey
          );
          if (unwrappedKey && rawBlob) {
            // unwrappedKey is a symmetric key string, not a PGP key, so it
            // must be passed as the passphrase argument of decryptSecret.
            const decrypted = await decryptSecret(rawBlob, undefined, unwrappedKey);
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
        } catch (err: any) {
          console.warn(`[Vault] revealPassword symmetric branch failed for item ${item.id}:`, err?.message || err);
        }
      }

      // Check resource_shares if item is shared or symmetric unwrap wasn't in local item
      if (item.ownerId !== user.id || !encSymKey) {
        try {
          const { data: shareData } = await withTimeout(
            supabase
              .from('resource_shares')
              .select('*')
              .eq('resource_id', item.id)
              .eq('recipient_id', user.id)
              .maybeSingle(),
            2500,
            'revealPassword resource_shares lookup'
          );

          if (shareData?.encrypted_symmetric_key) {
            const decryptedSymKey = await decryptWithPrivateKey(
              shareData.encrypted_symmetric_key,
              activeKey
            );
            const decrypted = rawBlob
              ? await decryptSecret(rawBlob, undefined, decryptedSymKey)
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
        } catch (err: any) {
          console.warn(`[Vault] revealPassword resource_share branch notice for item ${item.id}:`, err?.message || err);
        }
      }

      if (rawBlob && typeof rawBlob === 'string') {
        try {
          const decrypted = await decryptSecret(
            rawBlob,
            activeKey
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
        } catch (err: any) {
          console.warn(`[Vault] revealPassword direct-PGP branch failed for item ${item.id}:`, err?.message || err);
        }
      }

      if (item.noteContent && !isEncryptedCipher(item.noteContent)) {
        return await commitDecrypted(item.noteContent);
      }

      if (item.decryptedPassword && !isEncryptedCipher(item.decryptedPassword)) {
        return item.decryptedPassword;
      }

      // Legacy plaintext recovery
      const fallbackVal: any =
        (item as any).password ||
        (item as any).data?.password ||
        (item as any).data?.decryptedPassword ||
        (item as any).data?.noteContent ||
        (item as any).data?.secret ||
        (item as any).secret ||
        item.decryptedPassword ||
        '';

      if (fallbackVal && typeof fallbackVal === 'string' && !isEncryptedCipher(fallbackVal) &&
          fallbackVal !== '•••••••' && fallbackVal !== '••••••••') {
        return await commitDecrypted(fallbackVal);
      }

      console.warn(`[Vault] revealPassword: all branches exhausted for item ${item.id}`);
      throw new DecryptionFailedError(
        'Unable to decrypt this item. The stored secret may be damaged or the encryption key does not match.'
      );
    },
    [appMode, user]
  );

  const shareItemWithMember = useCallback(
    async (
      itemId: string,
      member: { id: string; name: string; email: string }
    ) => {
      try {
        if (!user) return false;

        const target = items.find((i) => i.id === itemId);
        if (!target) return false;

        const { data: recipientProfile } = await supabase
          .from('users')
          .select('*')
          .eq('id', member.id)
          .maybeSingle();

        const recipientPubKey: any =
          recipientProfile?.public_key ||
          recipientProfile?.data?.publicKey ||
          (member as any).publicKey;

        if (!recipientPubKey) {
          console.warn('[Vault] shareItemWithMember: recipient has no public key', member.id);
          return false;
        }

        // To unwrap the owner's key we need the owner's private key available.
        const activeKey = getSessionUnlockedKey();

        if (!activeKey || !isDecryptionKeyAvailable(activeKey)) {
          console.warn('[Vault] shareItemWithMember: no session decryption key available for item', target.id);
          return false;
        }

        let reEncryptedKey = '';

        // Prefer the modern scheme: the item stores a wrapped copy of the actual
        // symmetric key for the owner, and we re-wrap that same key for the
        // recipient. This matches how revealPassword consumes resource_shares.
        if (target.encryptedSymmetricKey && isEncryptedCipher(target.encryptedSymmetricKey)) {
          try {
            const itemSymmetricKey = await decryptWithPrivateKey(
              target.encryptedSymmetricKey,
              activeKey
            );
            if (itemSymmetricKey && !isEncryptedCipher(itemSymmetricKey)) {
              reEncryptedKey = await encryptWithPublicKey(
                itemSymmetricKey,
                recipientPubKey
              );
            }
          } catch (err: any) {
            console.warn(
              '[Vault] shareItemWithMember: failed to unwrap item symmetric key, falling back',
              target.id,
              err?.message || err
            );
          }
        }

        // Legacy fallback for items created before the symmetric-key scheme:
        if (!reEncryptedKey) {
          console.warn(
            '[Vault] shareItemWithMember: item has no wrapped symmetric key; sharing as legacy encrypted-secret',
            target.id
          );
          const revealedSecret = await revealPassword(target);
          if (!revealedSecret) return false;
          reEncryptedKey = await encryptWithPublicKey(
            revealedSecret,
            recipientPubKey
          );
        }

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
              } as any,
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
          sharedWithMembers: updatedMembers as any,
          isExternalShared: true,
        });
      } catch {
        return false;
      }
    },
    [appMode, items, revealPassword, updateItem, user]
  );

  const revokeSharing = useCallback(
    async (itemId: string, memberId?: string) => {
      try {
        if (!user) return false;

        const target = items.find((i) => i.id === itemId);
        if (!target) return false;

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
          const updatedShared = (target.sharedWith || []).filter(
            (id) => id !== memberId
          );
          const updatedMembers = (target.sharedWithMembers || []).filter(
            (m) => m.id !== memberId
          );
          return await updateItem(itemId, {
            sharedWith: updatedShared,
            sharedWithMembers: updatedMembers as any,
            isExternalShared: updatedShared.length > 0,
          });
        } else {
          return await updateItem(itemId, {
            sharedWith: [],
            sharedWithMembers: [],
            isExternalShared: false,
          });
        }
      } catch {
        return false;
      }
    },
    [items, updateItem, user]
  );

  const refreshVault = useCallback(async () => {
    if (!user) {
      const cached = await loadCachedVault(appMode);
      setItems(cached);
      setRawItems(cached);
      return;
    }
    await fetchVaultData(true);
  }, [appMode, fetchVaultData, user]);

  const checkAllBreaches = useCallback(async () => {
    if (!user) return { checked: 0, breached: 0 };
    let breached = 0;
    const updatedItems = [...items];

    for (let i = 0; i < updatedItems.length; i++) {
      const item = updatedItems[i];
      if (item.isPrivateOnly) continue;
      const secret = await revealPassword(item);
      const res = await checkPasswordBreach(secret);
      if (res.isBreached) {
        breached++;
        updatedItems[i] = {
          ...item,
          isLeaked: true,
          score: 20,
          strength: 'Weak',
        } as VaultItem;
      }
    }

    setItems(updatedItems);
    await AsyncStorage.setItem(
      `clickrypt_cached_vault_${appMode}`,
      JSON.stringify(updatedItems)
    );
    return { checked: items.length, breached };
  }, [appMode, items, revealPassword, user]);

  const value: VaultContextType = {
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
    refreshVault,
    checkAllBreaches,
  };

  return (
    <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
  );
};

export const useVault = (): VaultContextType => {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used inside VaultProvider');
  return ctx;
};
