// Supabase Edge Function: delete-account
// Serves privileged server-side account deletion with full organization cascade

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

    // User client to verify caller identity
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: authUser }, error: authError } = await userClient.auth.getUser();
    if (authError || !authUser) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized: Invalid auth session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Privileged admin client for cascade deletion
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const callerAuthId = authUser.id;
    const callerEmail = (authUser.email || '').toLowerCase().trim();

    // 1. Resolve caller profile in public.users
    const { data: callerUser } = await adminClient
      .from('users')
      .select('*')
      .or(`auth_id.eq.${callerAuthId},email.eq.${callerEmail}`)
      .maybeSingle();

    const callerDbId = callerUser?.id || callerAuthId;
    const isOrgOwner = callerUser?.role === 'Owner' || callerUser?.data?.role === 'Owner';

    const completedSteps: string[] = [];
    const deletedUserIds: string[] = [callerDbId];
    const deletedAuthIds: string[] = [callerAuthId];
    const deletedOrganizationIds: string[] = [];

    // 2. Identify organizations owned by this user
    const { data: ownedOrgs } = await adminClient
      .from('organizations')
      .select('*')
      .eq('owner_id', callerDbId);

    const ownedOrgList = ownedOrgs || [];
    for (const org of ownedOrgList) {
      deletedOrganizationIds.push(org.id);
    }

    let deletionType: 'PERSONAL_ACCOUNT' | 'ORGANIZATION_OWNER' = 'PERSONAL_ACCOUNT';

    // 3. If Organization Owner, collect all managed members under owned organizations
    if (isOrgOwner && deletedOrganizationIds.length > 0) {
      deletionType = 'ORGANIZATION_OWNER';

      // Explicit membership lookup (NO domain regex)
      const { data: orgMembers } = await adminClient
        .from('organization_members')
        .select('*')
        .in('organization_id', deletedOrganizationIds);

      // Users whose lifecycle is explicitly managed by this organization
      const { data: managedUsers } = await adminClient
        .from('users')
        .select('*')
        .in('managed_by_organization_id', deletedOrganizationIds);

      const memberUserIds = new Set<string>();
      if (orgMembers) {
        for (const m of orgMembers) {
          if (m.is_managed_account || m.role !== 'Owner') {
            memberUserIds.add(m.user_id);
          }
        }
      }
      if (managedUsers) {
        for (const u of managedUsers) {
          memberUserIds.add(u.id);
          if (u.auth_id && !deletedAuthIds.includes(u.auth_id)) {
            deletedAuthIds.push(u.auth_id);
          }
        }
      }

      for (const mId of memberUserIds) {
        if (!deletedUserIds.includes(mId)) {
          deletedUserIds.push(mId);
        }
      }
    }

    const allTargetUserIds = Array.from(new Set(deletedUserIds));

    // 4. CASCADE DELETION SEQUENCE:
    // Step 4.1: Delete Resource Shares
    await adminClient
      .from('resource_shares')
      .delete()
      .or(`shared_by.in.(${allTargetUserIds.join(',')}),recipient_id.in.(${allTargetUserIds.join(',')})`);
    completedSteps.push('RESOURCE_SHARES');

    // Step 4.2: Delete Group Folders & Group Members & Groups
    if (deletedOrganizationIds.length > 0) {
      const { data: orgGroups } = await adminClient
        .from('groups')
        .select('id')
        .in('organization_id', deletedOrganizationIds);
      
      const groupIds = (orgGroups || []).map((g: any) => g.id);
      if (groupIds.length > 0) {
        await adminClient.from('group_folders').delete().in('group_id', groupIds);
        await adminClient.from('group_members').delete().in('group_id', groupIds);
      }
    }

    await adminClient
      .from('group_members')
      .delete()
      .in('user_id', allTargetUserIds);

    await adminClient
      .from('groups')
      .delete()
      .or(`created_by.in.(${allTargetUserIds.join(',')}),owner_id.in.(${allTargetUserIds.join(',')})`);
    completedSteps.push('GROUPS');

    // Step 4.3: Delete Resources & Folders
    if (deletedOrganizationIds.length > 0) {
      await adminClient
        .from('resources')
        .delete()
        .or(`owner_id.in.(${allTargetUserIds.join(',')}),organization_id.in.(${deletedOrganizationIds.join(',')})`);

      await adminClient
        .from('folders')
        .delete()
        .or(`owner_id.in.(${allTargetUserIds.join(',')}),organization_id.in.(${deletedOrganizationIds.join(',')})`);
    } else {
      await adminClient.from('resources').delete().in('owner_id', allTargetUserIds);
      await adminClient.from('folders').delete().in('owner_id', allTargetUserIds);
    }
    completedSteps.push('RESOURCES_AND_FOLDERS');

    // Step 4.4: Delete Activity Logs
    await adminClient
      .from('activity_logs')
      .delete()
      .in('user_id', allTargetUserIds);
    completedSteps.push('ACTIVITY_LOGS');

    // Step 4.5: Delete Organization Memberships & Organizations
    if (deletedOrganizationIds.length > 0) {
      await adminClient
        .from('organization_members')
        .delete()
        .in('organization_id', deletedOrganizationIds);

      await adminClient
        .from('organizations')
        .delete()
        .in('id', deletedOrganizationIds);
      completedSteps.push('ORGANIZATIONS');
    }

    // Step 4.6: Delete Public Users Records
    await adminClient
      .from('users')
      .delete()
      .in('id', allTargetUserIds);
    completedSteps.push('PUBLIC_USERS');

    // Step 4.7: Delete Supabase Auth Users (Members first, Owner last)
    for (const authId of deletedAuthIds) {
      try {
        await adminClient.auth.admin.deleteUser(authId);
      } catch (err) {
        console.warn(`[delete-account] Notice deleting auth user ${authId}:`, err);
      }
    }
    completedSteps.push('AUTH_USERS');

    return new Response(
      JSON.stringify({
        success: true,
        deletionType,
        deletedOrganizationIds,
        deletedUserIds: allTargetUserIds,
        completedSteps,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err?.message || 'Server error during account deletion cascade',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
