// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const getEnv = (key: string): string => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
};

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = getEnv('SUPABASE_URL');
    const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      token
    );
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: authError?.message }),
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await req.json().catch(() => ({}));
    const appMode: 'personal' | 'organization' = body.appMode || 'personal';
    const authUserId = user.id;
    const authEmail = (user.email || '').toLowerCase().trim();

    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    // The mobile app stores resources.owner_id as public.users.id (u-...),
    // not as the Supabase Auth UUID. Resolve that id first.
    let customUserId = authUserId;
    const userIdSet = new Set<string>([authUserId]);
    try {
      const { data: profileRow } = await serviceClient
        .from('users')
        .select('id, email, auth_id')
        .or(`auth_id.eq.${authUserId},email.eq.${authEmail}`)
        .maybeSingle();
      if (profileRow?.id) {
        customUserId = profileRow.id;
        userIdSet.add(profileRow.id);
      }
    } catch {
      // If the users table lookup fails, still try the auth id fallback below.
    }

    const userIds = Array.from(userIdSet).filter(Boolean);
    const userIdList = userIds.join(',');

    // Build owner / share filters that match both the custom u-... id and the auth UUID.
    const ownerMatch = userIds
      .map((id) => `owner_id.eq.${id},data->>ownerId.eq.${id}`)
      .join(',');

    const { data: shareRows = [] } = await serviceClient
      .from('resource_shares')
      .select('*')
      .or(
        userIds
          .map((id) => `recipient_id.eq.${id},shared_by.eq.${id}`)
          .join(',')
      );

    const sharedResourceIds = (shareRows as any[])
      .filter((s: any) => s.resource_id)
      .map((s: any) => s.resource_id);
    const shareMap = new Map<string, any>(
      (shareRows as any[])
        .filter((s: any) => s.resource_id)
        .map((s: any) => [s.resource_id, s])
    );

    const folderPromise = serviceClient
      .from('folders')
      .select('*')
      .eq('mode', appMode)
      .or(ownerMatch);

    let resourceQuery = serviceClient
      .from('resources')
      .select('*')
      .eq('mode', appMode);

    const resourceOrParts = [ownerMatch];
    if (sharedResourceIds.length > 0) {
      resourceOrParts.push(`id.in.(${sharedResourceIds.join(',')})`);
    }
    resourceQuery = resourceQuery.or(resourceOrParts.join(','));

    const [folderRes, resourceRes] = await Promise.all([
      folderPromise,
      resourceQuery,
    ]);

    if (folderRes.error) {
      console.error('[vault-cache] folders error', folderRes.error);
    }
    if (resourceRes.error) {
      console.error('[vault-cache] resources error', resourceRes.error);
    }

    const folderRows = (folderRes.data as any[]) || [];
    const folders = folderRows.map(
      (f: any): any => ({
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
      })
    );

    const resourceRows = (resourceRes.data as any[]) || [];
    const items = resourceRows.map((r: any): any => {
      const d = normalizeData(r.data);
      const isShared = sharedResourceIds.includes(r.id);

      // Live DB stores secrets in `secrets_data` first; `data.secrets` is a mirror.
      const rawSecrets: any[] =
        Array.isArray(r.secrets_data) && r.secrets_data.length > 0
          ? r.secrets_data
          : Array.isArray(d.secrets) && d.secrets.length > 0
          ? d.secrets
          : Array.isArray(r.secrets) && r.secrets.length > 0
          ? r.secrets
          : d.encryptedData
          ? [{ userId: customUserId, encryptedData: d.encryptedData }]
          : r.encrypted_data
          ? [{ userId: customUserId, encryptedData: r.encrypted_data }]
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
          ? [{ userId: customUserId, encryptedData: candidateSecret }]
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
      const rawUrl =
        d.url || r.url || d.website || r.website || '';

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

      // Prefer the custom u-... id as ownerId; fall back to the auth UUID only if nothing else.
      const ownerId = r.owner_id || d.ownerId || customUserId;

      const itemType =
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
      };
    });

    const payload = JSON.stringify({ items, folders });
    return new Response(payload, { status: 200, headers: corsHeaders });
  } catch (err: any) {
    console.error('[vault-cache] error', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal server error' }),
      { status: 500, headers: corsHeaders }
    );
  }
});
