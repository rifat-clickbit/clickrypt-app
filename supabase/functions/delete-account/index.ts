// @ts-nocheck
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { Redis } from 'https://esm.sh/@upstash/redis@1.34.0';

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

interface StepError {
  step: string;
  table?: string;
  error: string;
}

interface DeleteResult {
  success: boolean;
  failedStep: string | null;
  failedTable: string | null;
  error: string | null;
  completedSteps: string[];
  warnings: string[];
  legacyGroupsSkipped: boolean;
}

const isNotFoundError = (message: string): boolean => {
  const m = (message || '').toLowerCase();
  return m.includes('not found') || m.includes('user not found') || m.includes('user not exist');
};

const safeString = (value: any): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (value.message) return String(value.message);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const joinIds = (ids: string[]): string => ids.map((id) => `${id}`).join(',');

const orFilter = (conditions: string[]): string => conditions.filter(Boolean).join(',');

const buildOwnerFilter = (userIds: string[]): string => {
  return orFilter(
    userIds.flatMap((id) => [`owner_id.eq.${id}`, `data->>ownerId.eq.${id}`])
  );
};

const buildUserIdFilter = (userIds: string[]): string => {
  return orFilter(userIds.map((id) => `user_id.eq.${id}`));
};

const buildShareFilter = (userIds: string[], resourceIds: string[]): string => {
  const direct = userIds.flatMap((id) => [`shared_by.eq.${id}`, `recipient_id.eq.${id}`]);
  const byResource = resourceIds.length ? [`resource_id.in.(${joinIds(resourceIds)})`] : [];
  return orFilter([...direct, ...byResource]);
};

class DeleteAccountFlow {
  private supabaseUrl: string;
  private supabaseAnonKey: string;
  private supabaseServiceRoleKey: string;
  private upstashUrl: string;
  private upstashToken: string;
  private authUserId: string = '';
  private authEmail: string = '';
  private customUserIds: string[] = [];
  private allUserIds: string[] = [];
  private ownedResourceIds: string[] = [];
  private ownedFolderIds: string[] = [];
  private serviceClient: SupabaseClient;
  private completedSteps: string[] = [];
  private warnings: string[] = [];
  private legacyGroupsSkipped = false;

  constructor(env: Record<string, string>) {
    this.supabaseUrl = env.SUPABASE_URL;
    this.supabaseAnonKey = env.SUPABASE_ANON_KEY;
    this.supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    this.upstashUrl = env.UPSTASH_REDIS_REST_URL;
    this.upstashToken = env.UPSTASH_REDIS_REST_TOKEN;
    this.serviceClient = createClient(this.supabaseUrl, this.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  }

  private fail(
    step: string,
    error: any,
    table?: string
  ): DeleteResult {
    return {
      success: false,
      failedStep: step,
      failedTable: table || null,
      error: safeString(error),
      completedSteps: this.completedSteps,
      warnings: this.warnings,
      legacyGroupsSkipped: this.legacyGroupsSkipped,
    };
  }

  private success(): DeleteResult {
    return {
      success: true,
      failedStep: null,
      failedTable: null,
      error: null,
      completedSteps: this.completedSteps,
      warnings: this.warnings,
      legacyGroupsSkipped: this.legacyGroupsSkipped,
    };
  }

  async run(token: string): Promise<DeleteResult> {
    try {
      // 1. Authenticate and resolve user identity
      const anonClient = createClient(this.supabaseUrl, this.supabaseAnonKey);
      const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
      if (authError || !user) {
        return this.fail('authenticate', authError?.message || 'Invalid or missing token');
      }
      this.authUserId = user.id;
      this.authEmail = (user.email || '').toLowerCase().trim();

      // 2. Resolve all public.users profile rows for this auth account/email
      const resolveResult = await this.resolveProfileIds();
      if (!resolveResult.success) return resolveResult;

      this.allUserIds = [...new Set([this.authUserId, ...this.customUserIds].filter(Boolean))];

      // 3. Enumerate owned resource/folder ids before any deletes
      const enumResult = await this.enumerateOwnedIds();
      if (!enumResult.success) return enumResult;

      // 4. Delete resource_shares (direct + by resource ownership)
      const sharesResult = await this.deleteResourceShares();
      if (!sharesResult.success) return sharesResult;

      // 5. Delete group_folders for owned folders (non-critical warning)
      await this.deleteGroupFoldersForUserFolders();

      // 6. Handle group memberships and user-owned groups
      const groupsResult = await this.cleanupGroups();
      if (!groupsResult.success) return groupsResult;

      // 7. Delete resources
      const resourcesResult = await this.deleteResources();
      if (!resourcesResult.success) return resourcesResult;

      // 8. Delete folders
      const foldersResult = await this.deleteFolders();
      if (!foldersResult.success) return foldersResult;

      // 9. Delete activity_logs
      const logsResult = await this.deleteActivityLogs();
      if (!logsResult.success) return logsResult;

      // 10. Delete team_members (by email, the only reliable column)
      const teamResult = await this.deleteTeamMembers();
      if (!teamResult.success) return teamResult;

      // 11. Verify zero critical user-owned data remains
      const verifyDataResult = await this.verifyNoUserDataRemains();
      if (!verifyDataResult.success) return verifyDataResult;

      // 12. Delete public.users profile(s)
      const usersResult = await this.deleteUsersProfiles();
      if (!usersResult.success) return usersResult;

      // 13. Verify public.users row gone
      const verifyUsersResult = await this.verifyNoUsersProfile();
      if (!verifyUsersResult.success) return verifyUsersResult;

      // 14. Delete Supabase Auth user
      const authDeleteResult = await this.deleteAuthUser();
      if (!authDeleteResult.success) return authDeleteResult;

      // 15. Verify Auth user gone
      const verifyAuthResult = await this.verifyAuthUserGone();
      if (!verifyAuthResult.success) return verifyAuthResult;

      // 16. Best-effort cache invalidation (non-critical)
      await this.invalidateCache();

      return this.success();
    } catch (err: any) {
      console.error('[delete-account] unhandled error', err);
      return this.fail('unhandled', err?.message || 'Internal server error');
    }
  }

  private async resolveProfileIds(): Promise<DeleteResult | { success: true }> {
    try {
      const { data: rows, error } = await this.serviceClient
        .from('users')
        .select('id, auth_id, email')
        .or(`auth_id.eq.${this.authUserId},email.eq.${this.authEmail}`);

      if (error) {
        return this.fail('resolve_profile', error, 'users');
      }

      if (!rows || rows.length === 0) {
        this.warnings.push(
          'resolve_profile: No public.users profile found for this auth account; owner-id cleanup may be incomplete.'
        );
      } else {
        if (rows.length > 1) {
          this.warnings.push(
            `resolve_profile: Found ${rows.length} public.users rows for the same auth account; all will be deleted.`
          );
        }
        this.customUserIds = rows.map((r) => r.id).filter(Boolean);
      }

      this.completedSteps.push('resolve_profile');
      return { success: true };
    } catch (err: any) {
      return this.fail('resolve_profile', err, 'users');
    }
  }

  private async enumerateOwnedIds(): Promise<DeleteResult | { success: true }> {
    try {
      const ownerFilter = buildOwnerFilter(this.allUserIds);

      const { data: resourceRows, error: resourceError } = await this.serviceClient
        .from('resources')
        .select('id')
        .or(ownerFilter);
      if (resourceError) {
        return this.fail('enumerate_resources', resourceError, 'resources');
      }
      this.ownedResourceIds = (resourceRows || []).map((r) => r.id).filter(Boolean);

      const { data: folderRows, error: folderError } = await this.serviceClient
        .from('folders')
        .select('id')
        .or(ownerFilter);
      if (folderError) {
        return this.fail('enumerate_folders', folderError, 'folders');
      }
      this.ownedFolderIds = (folderRows || []).map((f) => f.id).filter(Boolean);

      this.completedSteps.push('enumerate_owned_ids');
      return { success: true };
    } catch (err: any) {
      return this.fail('enumerate_owned_ids', err);
    }
  }

  private async deleteResourceShares(): Promise<DeleteResult | { success: true }> {
    try {
      const shareFilter = buildShareFilter(this.allUserIds, this.ownedResourceIds);
      if (!shareFilter) {
        this.completedSteps.push('delete_resource_shares');
        return { success: true };
      }

      const { error } = await this.serviceClient
        .from('resource_shares')
        .delete()
        .or(shareFilter);
      if (error) {
        return this.fail('delete_resource_shares', error, 'resource_shares');
      }

      this.completedSteps.push('delete_resource_shares');
      return { success: true };
    } catch (err: any) {
      return this.fail('delete_resource_shares', err, 'resource_shares');
    }
  }

  private async deleteGroupFoldersForUserFolders(): Promise<void> {
    try {
      if (this.ownedFolderIds.length === 0) {
        this.completedSteps.push('delete_group_folders_for_user_folders');
        return;
      }

      const { error } = await this.serviceClient
        .from('group_folders')
        .delete()
        .in('folder_id', this.ownedFolderIds);

      if (error) {
        this.warnings.push(`delete_group_folders_for_user_folders: ${safeString(error)}`);
      } else {
        this.completedSteps.push('delete_group_folders_for_user_folders');
      }
    } catch (err: any) {
      this.warnings.push(`delete_group_folders_for_user_folders: ${safeString(err)}`);
    }
  }

  private async cleanupGroups(): Promise<DeleteResult | { success: true }> {
    try {
      const userIdFilter = buildUserIdFilter(this.allUserIds);

      // Step A: delete all group_members rows for this user. This is the
      // authoritative membership removal and is always required.
      const { data: deletedMemberships, error: membershipDeleteError } =
        await this.serviceClient
          .from('group_members')
          .delete()
          .or(userIdFilter)
          .select('group_id');
      if (membershipDeleteError) {
        return this.fail('cleanup_group_members', membershipDeleteError, 'group_members');
      }

      const groupIds = [
        ...new Set((deletedMemberships || []).map((m) => m.group_id).filter(Boolean)),
      ];

      if (groupIds.length === 0) {
        this.completedSteps.push('cleanup_groups');
        return { success: true };
      }

      // Step B: decide which of those groups the user actually created/owns.
      // The `created_by` column only exists after a schema migration. If it's
      // not present yet, every group is treated as legacy/shared: we keep it,
      // only removing the membership we already deleted above.
      let createdByMissing = false;
      let groupRows: any[] = [];
      try {
        const res = await this.serviceClient
          .from('groups')
          .select('id, created_by, data, members_data')
          .in('id', groupIds);
        if (res.error && this.isColumnMissingError(res.error, 'groups.created_by')) {
          createdByMissing = true;
        } else if (res.error) {
          return this.fail('cleanup_groups', res.error, 'groups');
        } else {
          groupRows = res.data || [];
        }
      } catch (err: any) {
        if (this.isColumnMissingError(err, 'groups.created_by')) {
          createdByMissing = true;
        } else {
          return this.fail('cleanup_groups', err, 'groups');
        }
      }

      if (createdByMissing) {
        this.warnings.push(
          'cleanup_groups: groups.created_by column not present; treating all groups as legacy/shared and leaving them intact.'
        );
        this.legacyGroupsSkipped = true;
      }

      for (const group of groupRows || []) {
        const isUserOwned =
          !createdByMissing &&
          group.created_by &&
          this.allUserIds.includes(group.created_by);

        if (isUserOwned) {
          // Delete group_folders for this group
          const { error: gfError } = await this.serviceClient
            .from('group_folders')
            .delete()
            .eq('group_id', group.id);
          if (gfError) {
            return this.fail('cleanup_user_owned_group_folders', gfError, 'group_folders');
          }

          // The group has no members now (membership rows deleted in step A).
          // Delete the group itself.
          const { error: gError } = await this.serviceClient
            .from('groups')
            .delete()
            .eq('id', group.id);
          if (gError) {
            return this.fail('delete_user_owned_group', gError, 'groups');
          }
        } else {
          this.legacyGroupsSkipped = true;

          // Best-effort JSONB member list pruning (warning only)
          try {
            const updated = this.pruneGroupMembers(group.data, this.allUserIds);
            const { error: patchError } = await this.serviceClient
              .from('groups')
              .update({ data: updated })
              .eq('id', group.id);
            if (patchError) {
              this.warnings.push(
                `cleanup_groups_jsonb: ${group.id}: ${safeString(patchError)}`
              );
            }
          } catch (jsonErr: any) {
            this.warnings.push(
              `cleanup_groups_jsonb: ${group.id}: ${safeString(jsonErr)}`
            );
          }
        }
      }

      this.completedSteps.push('cleanup_groups');
      return { success: true };
    } catch (err: any) {
      return this.fail('cleanup_groups', err, 'groups');
    }
  }

  private isColumnMissingError(err: any, columnRef: string): boolean {
    const m = safeString(err?.message || err).toLowerCase();
    return m.includes('could not find') && m.includes(columnRef.toLowerCase());
  }

  private pruneGroupMembers(data: any, userIds: string[]): any {
    if (!data || typeof data !== 'object') return data;
    const next = { ...data };

    if (Array.isArray(next.members)) {
      next.members = next.members.filter((m: any) => {
        if (typeof m === 'string') return !userIds.includes(m);
        if (m && typeof m === 'object' && m.id) return !userIds.includes(m.id);
        return true;
      });
    }

    if (Array.isArray(next.memberIds)) {
      next.memberIds = next.memberIds.filter((m: any) => {
        if (typeof m === 'string') return !userIds.includes(m);
        if (m && typeof m === 'object' && m.id) return !userIds.includes(m.id);
        return true;
      });
    }

    if (Array.isArray(next.assignedFolderIds)) {
      // assignedFolderIds are folder ids, not user ids; leave intact
    }

    if (Array.isArray(next.assignedResourceIds)) {
      // assignedResourceIds are resource ids, not user ids; leave intact
    }

    return next;
  }

  private async deleteResources(): Promise<DeleteResult | { success: true }> {
    try {
      if (this.ownedResourceIds.length === 0) {
        this.completedSteps.push('delete_resources');
        return { success: true };
      }

      const { error } = await this.serviceClient
        .from('resources')
        .delete()
        .in('id', this.ownedResourceIds);
      if (error) {
        return this.fail('delete_resources', error, 'resources');
      }

      this.completedSteps.push('delete_resources');
      return { success: true };
    } catch (err: any) {
      return this.fail('delete_resources', err, 'resources');
    }
  }

  private async deleteFolders(): Promise<DeleteResult | { success: true }> {
    try {
      if (this.ownedFolderIds.length === 0) {
        this.completedSteps.push('delete_folders');
        return { success: true };
      }

      const { error } = await this.serviceClient
        .from('folders')
        .delete()
        .in('id', this.ownedFolderIds);
      if (error) {
        return this.fail('delete_folders', error, 'folders');
      }

      this.completedSteps.push('delete_folders');
      return { success: true };
    } catch (err: any) {
      return this.fail('delete_folders', err, 'folders');
    }
  }

  private async deleteActivityLogs(): Promise<DeleteResult | { success: true }> {
    try {
      const filter = buildUserIdFilter(this.allUserIds);
      if (!filter) {
        this.completedSteps.push('delete_activity_logs');
        return { success: true };
      }

      const { error } = await this.serviceClient
        .from('activity_logs')
        .delete()
        .or(filter);
      if (error) {
        return this.fail('delete_activity_logs', error, 'activity_logs');
      }

      this.completedSteps.push('delete_activity_logs');
      return { success: true };
    } catch (err: any) {
      return this.fail('delete_activity_logs', err, 'activity_logs');
    }
  }

  private async deleteTeamMembers(): Promise<DeleteResult | { success: true }> {
    try {
      if (!this.authEmail) {
        this.warnings.push('delete_team_members: No auth email available; skipping.');
        this.completedSteps.push('delete_team_members');
        return { success: true };
      }

      const { error } = await this.serviceClient
        .from('team_members')
        .delete()
        .eq('email', this.authEmail);
      if (error) {
        return this.fail('delete_team_members', error, 'team_members');
      }

      this.completedSteps.push('delete_team_members');
      return { success: true };
    } catch (err: any) {
      return this.fail('delete_team_members', err, 'team_members');
    }
  }

  private async verifyNoUserDataRemains(): Promise<DeleteResult | { success: true }> {
    const remaining: { table: string; count: number }[] = [];

    try {
      // Resources
      const { count: rCount, error: rErr } = await this.serviceClient
        .from('resources')
        .select('id', { count: 'exact', head: true })
        .or(buildOwnerFilter(this.allUserIds));
      if (rErr) return this.fail('verify_resources', rErr, 'resources');
      if (rCount && rCount > 0) remaining.push({ table: 'resources', count: rCount });

      // Folders
      const { count: fCount, error: fErr } = await this.serviceClient
        .from('folders')
        .select('id', { count: 'exact', head: true })
        .or(buildOwnerFilter(this.allUserIds));
      if (fErr) return this.fail('verify_folders', fErr, 'folders');
      if (fCount && fCount > 0) remaining.push({ table: 'folders', count: fCount });

      // Resource shares
      const shareFilter = buildShareFilter(this.allUserIds, this.ownedResourceIds);
      if (shareFilter) {
        const { count: rsCount, error: rsErr } = await this.serviceClient
          .from('resource_shares')
          .select('id', { count: 'exact', head: true })
          .or(shareFilter);
        if (rsErr) return this.fail('verify_resource_shares', rsErr, 'resource_shares');
        if (rsCount && rsCount > 0) remaining.push({ table: 'resource_shares', count: rsCount });
      }

      // Group memberships
      const userIdFilter = buildUserIdFilter(this.allUserIds);
      if (userIdFilter) {
        const { count: gmCount, error: gmErr } = await this.serviceClient
          .from('group_members')
          .select('group_id,user_id', { count: 'exact', head: true })
          .or(userIdFilter);
        if (gmErr) return this.fail('verify_group_members', gmErr, 'group_members');
        if (gmCount && gmCount > 0) remaining.push({ table: 'group_members', count: gmCount });
      }

      // Activity logs
      if (userIdFilter) {
        const { count: alCount, error: alErr } = await this.serviceClient
          .from('activity_logs')
          .select('id', { count: 'exact', head: true })
          .or(userIdFilter);
        if (alErr) return this.fail('verify_activity_logs', alErr, 'activity_logs');
        if (alCount && alCount > 0) remaining.push({ table: 'activity_logs', count: alCount });
      }

      // Team members
      if (this.authEmail) {
        const { count: tmCount, error: tmErr } = await this.serviceClient
          .from('team_members')
          .select('id', { count: 'exact', head: true })
          .eq('email', this.authEmail);
        if (tmErr) return this.fail('verify_team_members', tmErr, 'team_members');
        if (tmCount && tmCount > 0) remaining.push({ table: 'team_members', count: tmCount });
      }

      // User-owned groups (only if the created_by column exists)
      try {
        const groupFilter = buildUserIdFilter(this.allUserIds).replace(
          /user_id/g,
          'created_by'
        );
        const { count: ogCount, error: ogErr } = await this.serviceClient
          .from('groups')
          .select('id', { count: 'exact', head: true })
          .or(groupFilter);
        if (ogErr && !this.isColumnMissingError(ogErr, 'groups.created_by')) {
          return this.fail('verify_user_owned_groups', ogErr, 'groups');
        }
        if (ogCount && ogCount > 0) remaining.push({ table: 'groups', count: ogCount });
      } catch (err: any) {
        if (!this.isColumnMissingError(err, 'groups.created_by')) {
          return this.fail('verify_user_owned_groups', err, 'groups');
        }
      }

      if (remaining.length > 0) {
        return this.fail(
          'verify_no_user_data_remains',
          `Verification failed: ${remaining.map((x) => `${x.table}=${x.count}`).join(', ')} row(s) still exist for this user.`,
          remaining[0].table
        );
      }

      this.completedSteps.push('verify_no_user_data_remains');
      return { success: true };
    } catch (err: any) {
      return this.fail('verify_no_user_data_remains', err);
    }
  }

  private async deleteUsersProfiles(): Promise<DeleteResult | { success: true }> {
    try {
      if (this.customUserIds.length === 0) {
        this.warnings.push('delete_users_profile: No public.users profile(s) to delete.');
        this.completedSteps.push('delete_users_profile');
        return { success: true };
      }

      const { error } = await this.serviceClient
        .from('users')
        .delete()
        .in('id', this.customUserIds);
      if (error) {
        return this.fail('delete_users_profile', error, 'users');
      }

      this.completedSteps.push('delete_users_profile');
      return { success: true };
    } catch (err: any) {
      return this.fail('delete_users_profile', err, 'users');
    }
  }

  private async verifyNoUsersProfile(): Promise<DeleteResult | { success: true }> {
    try {
      const filters = [
        this.authUserId ? `auth_id.eq.${this.authUserId}` : '',
        this.authEmail ? `email.eq.${this.authEmail}` : '',
        ...this.customUserIds.map((id) => `id.eq.${id}`),
      ].filter(Boolean);

      if (filters.length === 0) {
        this.completedSteps.push('verify_no_users_profile');
        return { success: true };
      }

      const { count, error } = await this.serviceClient
        .from('users')
        .select('id', { count: 'exact', head: true })
        .or(filters.join(','));
      if (error) return this.fail('verify_no_users_profile', error, 'users');
      if (count && count > 0) {
        return this.fail(
          'verify_no_users_profile',
          `${count} public.users row(s) still exist for this auth account.`,
          'users'
        );
      }

      this.completedSteps.push('verify_no_users_profile');
      return { success: true };
    } catch (err: any) {
      return this.fail('verify_no_users_profile', err, 'users');
    }
  }

  private async deleteAuthUser(): Promise<DeleteResult | { success: true }> {
    try {
      const { error } = await this.serviceClient.auth.admin.deleteUser(this.authUserId);
      if (error) {
        if (isNotFoundError(error.message)) {
          // Already deleted; treat as success but warn
          this.warnings.push('delete_auth_user: Auth user was already deleted.');
          this.completedSteps.push('delete_auth_user');
          return { success: true };
        }
        return this.fail('delete_auth_user', error, 'auth.users');
      }

      this.completedSteps.push('delete_auth_user');
      return { success: true };
    } catch (err: any) {
      if (isNotFoundError(safeString(err))) {
        this.warnings.push('delete_auth_user: Auth user was already deleted.');
        this.completedSteps.push('delete_auth_user');
        return { success: true };
      }
      return this.fail('delete_auth_user', err, 'auth.users');
    }
  }

  private async verifyAuthUserGone(): Promise<DeleteResult | { success: true }> {
    try {
      const { data, error } = await this.serviceClient.auth.admin.getUserById(
        this.authUserId
      );
      if (error) {
        // Expected not-found error means user is gone
        this.completedSteps.push('verify_auth_user_gone');
        return { success: true };
      }
      if (data?.user) {
        return this.fail(
          'verify_auth_user_gone',
          `Auth user still exists after deletion: ${data.user.id}`,
          'auth.users'
        );
      }

      this.completedSteps.push('verify_auth_user_gone');
      return { success: true };
    } catch (err: any) {
      // Expected to fail
      this.completedSteps.push('verify_auth_user_gone');
      return { success: true };
    }
  }

  private async invalidateCache(): Promise<void> {
    try {
      const redis = new Redis({ url: this.upstashUrl, token: this.upstashToken });
      await redis.del(`user:${this.authUserId}`);
      this.completedSteps.push('invalidate_cache');
    } catch (err: any) {
      this.warnings.push(`invalidate_cache: ${safeString(err)}`);
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const env = {
      SUPABASE_URL: getEnv('SUPABASE_URL'),
      SUPABASE_ANON_KEY: getEnv('SUPABASE_ANON_KEY'),
      SUPABASE_SERVICE_ROLE_KEY: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      UPSTASH_REDIS_REST_URL: getEnv('UPSTASH_REDIS_REST_URL'),
      UPSTASH_REDIS_REST_TOKEN: getEnv('UPSTASH_REDIS_REST_TOKEN'),
    };

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const flow = new DeleteAccountFlow(env);
    const result = await flow.run(token);

    // Authentication errors should return 401, not 500.
    const status = result.success
      ? 200
      : result.failedStep === 'authenticate'
      ? 401
      : 500;

    return new Response(JSON.stringify(result), {
      status,
      headers: corsHeaders,
    });
  } catch (err: any) {
    console.error('[delete-account] unhandled error', err);
    return new Response(
      JSON.stringify({
        success: false,
        failedStep: 'unhandled',
        failedTable: null,
        error: err?.message || 'Internal server error',
        completedSteps: [],
        warnings: [],
        legacyGroupsSkipped: false,
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});
