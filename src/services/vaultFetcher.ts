import { SupabaseClient } from '@supabase/supabase-js';
import { VaultItem, FolderItem, UserProfile } from '../types';

const isEncryptedCipher = (val: string | undefined | null): boolean => {
  if (!val || typeof val !== 'string') return false;
  const trimmed = val.trim();
  return (
    trimmed.startsWith('-----BEGIN PGP MESSAGE-----') ||
    trimmed.startsWith('-----BEGIN ENCRYPTED') ||
    trimmed.startsWith('-----BEGIN ') ||
    trimmed.startsWith('[PGP-ENCRYPTED-BLOB::') ||
    trimmed.startsWith('[RSA-ENCRYPTED-KEY::') ||
    trimmed.startsWith('[ENCRYPTED-PRIV-KEY::') ||
    trimmed.startsWith('[PUBLIC-KEY::') ||
    trimmed.startsWith('U2FsdGVkX1')
  );
};

const normalizeData = (raw: any): any => {
  if (raw && typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === 'object') return raw;
  return {};
};

const buildOwnerFilter = (userIds: string[]): string => {
  return userIds
    .filter(Boolean)
    .map((id) => `owner_id.eq.${id}`)
    .join(',');
};

export interface VaultFetchResult {
  items: VaultItem[];
  folders: FolderItem[];
}

export const fetchVaultDirect = async (
  supabase: SupabaseClient,
  user: UserProfile,
  appMode: 'personal' | 'organization'
): Promise<VaultFetchResult | null> => {
  try {
    const userIds = [user.id, user.authId].filter(
      (id): id is string => !!id
    ) as string[];

    if (userIds.length === 0) return null;

    const ownerFilter = buildOwnerFilter(userIds);

    const { data: shareRows, error: shareError } = await supabase
      .from('resource_shares')
      .select('*')
      .or(
        userIds
          .flatMap((id) => [
            `recipient_id.eq.${id}`,
            `shared_by.eq.${id}`,
          ])
          .join(',')
      );

    if (shareError) {
      console.warn('[vaultFetcher] resource_shares error', shareError);
    }

    const validShares = (shareRows || []).filter((s: any) => s.resource_id);
    const sharedResourceIds = validShares.map((s: any) => s.resource_id);
    const shareMap = new Map<string, any>(
      validShares.map((s: any) => [s.resource_id, s])
    );

    const resourceOrParts = [ownerFilter];
    if (sharedResourceIds.length > 0) {
      resourceOrParts.push(`id.in.(${sharedResourceIds.join(',')})`);
    }

    const [folderRes, resourceRes] = await Promise.all([
      supabase.from('folders').select('*').eq('mode', appMode).or(ownerFilter).then(
        (res) => res,
        (err) => ({ data: [], error: err })
      ),
      supabase
        .from('resources')
        .select('*')
        .eq('mode', appMode)
        .or(resourceOrParts.join(',')).then(
          (res) => res,
          (err) => ({ data: null, error: err })
        ),
    ]);

    if (folderRes.error) {
      console.warn('[vaultFetcher] folders notice', folderRes.error);
    }
    if (resourceRes.error) {
      console.warn('[vaultFetcher] resources notice', resourceRes.error);
      if (!resourceRes.data) return null;
    }

    const folderRows = (folderRes.data as any[]) || [];
    const folders: FolderItem[] = folderRows.map((f: any) => ({
      id: f.id,
      name: f.name || f.data?.name || 'Folder',
      description: f.description || f.data?.description,
      color: f.data?.color || f.color || '#FBBF24',
      itemCount: f.data?.itemCount || f.item_count || 0,
      lastModified:
        f.last_modified ||
        f.data?.lastModified ||
        f.created_at ||
        'Just now',
      mode: f.mode,
      isPrivateOnly: f.data?.isPrivateOnly,
    }));

    const resourceRows = (resourceRes.data as any[]) || [];
    const items: VaultItem[] = resourceRows.map((r: any) => {
      const d = normalizeData(r.data);
      const isShared = sharedResourceIds.includes(r.id);

      const rawSecrets: any[] =
        Array.isArray(r.secrets_data) && r.secrets_data.length > 0
          ? r.secrets_data
          : Array.isArray(d.secrets) && d.secrets.length > 0
          ? d.secrets
          : Array.isArray(r.secrets) && r.secrets.length > 0
          ? r.secrets
          : d.encryptedData
          ? [{ userId: user.id, encryptedData: d.encryptedData }]
          : r.encrypted_data
          ? [{ userId: user.id, encryptedData: r.encrypted_data }]
          : [];

      const candidateSecret: any =
        d.encryptedData ||
        d.encryptedPassword ||
        r.encrypted_data ||
        d.password ||
        r.password ||
        d.secret ||
        r.secret;

      const finalSecrets: any[] =
        rawSecrets.length > 0
          ? rawSecrets
          : candidateSecret &&
            typeof candidateSecret === 'string' &&
            isEncryptedCipher(candidateSecret)
          ? [{ userId: user.id, encryptedData: candidateSecret }]
          : [];

      const rawName =
        d.name ||
        r.name ||
        d.title ||
        r.title ||
        d.label ||
        r.label ||
        'Untitled Item';
      const rawUsername =
        d.username ||
        r.username ||
        d.user ||
        r.user ||
        d.email ||
        r.email ||
        '';
      const rawUrl = d.url || r.url || d.website || r.website || '';

      const encryptedSymKey: any =
        d.encryptedSymmetricKey ||
        d.encrypted_symmetric_key ||
        shareMap.get(r.id)?.encrypted_symmetric_key;

      const isPrivateOnly = !!(
        d.isPrivateOnly ||
        r.is_private_only ||
        d.is_private_only ||
        r.item_type === 'card' ||
        d.itemType === 'card'
      );

      const ownerId = r.owner_id || d.ownerId || user.id;

      const itemType: VaultItem['itemType'] =
        r.item_type ||
        d.itemType ||
        (isPrivateOnly ? 'card' : 'login');

      const isDeleted = !!(
        d.isDeleted ||
        d.deletedAt ||
        r.deleted_at ||
        d.deleted_by ||
        r.deleted_by
      );

      return {
        ...d,
        id: r.id,
        name: rawName,
        username: rawUsername,
        url: rawUrl,
        folderId: r.folder_id || d.folderId || null,
        ownerId,
        isPrivateOnly,
        score:
          typeof d.score === 'number'
            ? d.score
            : typeof r.score === 'number'
            ? r.score
            : 80,
        strength: d.strength || r.strength || 'Good',
        lastModified:
          d.lastModified || r.last_modified || r.created_at || 'Recently',
        isOld: !!d.isOld,
        isLeaked: !!d.isLeaked,
        secrets: finalSecrets,
        tags: Array.isArray(d.tags) ? d.tags : [],
        mode: r.mode || d.mode || appMode,
        decryptedPassword: undefined,
        noteContent: undefined,
        encryptedSymmetricKey: encryptedSymKey,
        itemType,
        isDeleted,
        deletedAt: d.deletedAt || r.deleted_at,
        sharedWith: Array.isArray(d.sharedWith)
          ? d.sharedWith
          : isShared
          ? userIds
          : [],
        sharedWithMembers: Array.isArray(d.sharedWithMembers)
          ? d.sharedWithMembers
          : [],
        ownerName: d.ownerName || r.owner_name,
        ownerEmail: d.ownerEmail || r.owner_email,
      } as VaultItem;
    });

    return { items, folders };
  } catch (err) {
    console.warn('[vaultFetcher] failed', err);
    return null;
  }
};
