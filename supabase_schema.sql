-- ====================================================================
-- CLICKRYPT ADVANCED ZERO-KNOWLEDGE SUPABASE DATABASE SCHEMA
-- Canonical Relational Architecture with Full Foreign Key Integrity,
-- Cascade Rules, Trigger-Enforced Counts, and Row Level Security (RLS)
-- ====================================================================

-- Enable UUID & cryptographic extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ====================================================================
-- 1. BASE ENTITY TABLES
-- ====================================================================

-- 1.1 'users' table (Profiles & OpenPGP RSA Public Keys)
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    auth_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'Member' NOT NULL,
    status TEXT DEFAULT 'Active' NOT NULL,
    account_mode TEXT DEFAULT 'personal' NOT NULL,
    organization_id TEXT,
    managed_by_organization_id TEXT,
    avatar_url TEXT,
    public_key TEXT,
    encrypted_private_key TEXT,
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret TEXT,
    data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 1.2 'organizations' table (Multi-Tenant Organization Accounts)
CREATE TABLE IF NOT EXISTS public.organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    owner_id TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    data JSONB DEFAULT '{}'::jsonb
);

-- Add foreign key references from users to organizations
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_organization') THEN
        ALTER TABLE public.users
            ADD CONSTRAINT fk_users_organization
            FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_managed_by_org') THEN
        ALTER TABLE public.users
            ADD CONSTRAINT fk_users_managed_by_org
            FOREIGN KEY (managed_by_organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 1.3 'organization_members' table (Organization Roster & RBAC)
CREATE TABLE IF NOT EXISTS public.organization_members (
    id TEXT PRIMARY KEY DEFAULT ('om-' || substr(gen_random_uuid()::text, 1, 12)),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'Member' NOT NULL,
    is_managed_account BOOLEAN DEFAULT FALSE NOT NULL,
    status TEXT DEFAULT 'active' NOT NULL,
    invited_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT uq_organization_user UNIQUE (organization_id, user_id)
);

-- 1.4 'folders' table (Vault Categories)
CREATE TABLE IF NOT EXISTS public.folders (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#FBBF24',
    mode TEXT DEFAULT 'personal' NOT NULL,
    item_count INTEGER DEFAULT 0 NOT NULL,
    last_modified TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 1.5 'resources' table (Encrypted Vault Credentials & Items)
CREATE TABLE IF NOT EXISTS public.resources (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES public.folders(id) ON DELETE SET NULL,
    name TEXT,
    mode TEXT DEFAULT 'personal' NOT NULL,
    item_type TEXT DEFAULT 'login' NOT NULL,
    category TEXT DEFAULT 'login',
    secrets_data JSONB,
    encrypted_data TEXT,
    encrypted_symmetric_key TEXT,
    is_private_only BOOLEAN DEFAULT FALSE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    deleted_by TEXT,
    last_modified TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    data JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 1.6 'resource_shares' table (Passbolt-style Asymmetric ZK Sharing)
CREATE TABLE IF NOT EXISTS public.resource_shares (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    encrypted_symmetric_key TEXT NOT NULL,
    shared_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    permission TEXT DEFAULT 'read' NOT NULL,
    shared_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(resource_id, recipient_id)
);

-- 1.7 'groups' table (Access Control Groups)
CREATE TABLE IF NOT EXISTS public.groups (
    id TEXT PRIMARY KEY,
    organization_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE,
    owner_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
    created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    mode TEXT DEFAULT 'organization' NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 1.8 'group_members' join table
CREATE TABLE IF NOT EXISTS public.group_members (
    group_id TEXT NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'Member' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

-- 1.9 'group_folders' join table
CREATE TABLE IF NOT EXISTS public.group_folders (
    group_id TEXT NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    folder_id TEXT NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (group_id, folder_id)
);

-- 1.10 'activity_logs' table (Audit Logging)
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
    organization_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE,
    resource_id TEXT REFERENCES public.resources(id) ON DELETE SET NULL,
    group_id TEXT REFERENCES public.groups(id) ON DELETE SET NULL,
    user_email TEXT,
    email_snapshot TEXT,
    action TEXT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    category TEXT DEFAULT 'vault' NOT NULL,
    mode TEXT DEFAULT 'personal' NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 1.11 Legacy compatibility 'team_members' table (Deprecated in favor of organization_members)
CREATE TABLE IF NOT EXISTS public.team_members (
    id TEXT PRIMARY KEY,
    organization_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'Member' NOT NULL,
    status TEXT DEFAULT 'Active' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ====================================================================
-- 2. INDEXES FOR HIGH-SPEED LOOKUPS & RELATIONAL INTEGRITY
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users(auth_id);
CREATE INDEX IF NOT EXISTS idx_users_org_id ON public.users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_managed_by_org ON public.users(managed_by_organization_id);

CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON public.organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_organizations_domain ON public.organizations(domain);

CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON public.organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_is_managed ON public.organization_members(is_managed_account);

CREATE INDEX IF NOT EXISTS idx_resources_owner_id ON public.resources(owner_id);
CREATE INDEX IF NOT EXISTS idx_resources_folder_id ON public.resources(folder_id);
CREATE INDEX IF NOT EXISTS idx_resources_org_id ON public.resources(organization_id);
CREATE INDEX IF NOT EXISTS idx_resources_mode ON public.resources(mode);
CREATE INDEX IF NOT EXISTS idx_resources_deleted_at ON public.resources(deleted_at);

CREATE INDEX IF NOT EXISTS idx_resource_shares_lookup ON public.resource_shares(resource_id, recipient_id);
CREATE INDEX IF NOT EXISTS idx_resource_shares_recipient ON public.resource_shares(recipient_id);
CREATE INDEX IF NOT EXISTS idx_resource_shares_shared_by ON public.resource_shares(shared_by);

CREATE INDEX IF NOT EXISTS idx_folders_owner_id ON public.folders(owner_id);
CREATE INDEX IF NOT EXISTS idx_folders_org_id ON public.folders(organization_id);

CREATE INDEX IF NOT EXISTS idx_groups_created_by ON public.groups(created_by);
CREATE INDEX IF NOT EXISTS idx_groups_owner_id ON public.groups(owner_id);
CREATE INDEX IF NOT EXISTS idx_groups_org_id ON public.groups(organization_id);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON public.group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_org_id ON public.activity_logs(organization_id);

-- ====================================================================
-- 3. RELATIONAL VIEWS
-- ====================================================================
CREATE OR REPLACE VIEW public.groups_with_members AS
SELECT
  g.*,
  COALESCE((SELECT json_agg(gm.user_id) FROM public.group_members gm WHERE gm.group_id = g.id), '[]'::json) AS member_ids,
  COALESCE((SELECT json_agg(gf.folder_id) FROM public.group_folders gf WHERE gf.group_id = g.id), '[]'::json) AS folder_ids,
  COALESCE((SELECT count(*)::int FROM public.group_members gm WHERE gm.group_id = g.id), 0) AS member_count
FROM public.groups g;

-- ====================================================================
-- 4. TRIGGERS & AUTOMATION
-- ====================================================================

-- 4.1 Trigger function: Maintain folder item_count accurately (handles soft-delete)
CREATE OR REPLACE FUNCTION public.update_folder_item_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_old_active boolean;
  v_new_active boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.folder_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
      UPDATE public.folders SET item_count = COALESCE(item_count, 0) + 1 WHERE id = NEW.folder_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.folder_id IS NOT NULL AND OLD.deleted_at IS NULL THEN
      UPDATE public.folders SET item_count = GREATEST(0, COALESCE(item_count, 1) - 1) WHERE id = OLD.folder_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_active := (OLD.deleted_at IS NULL);
    v_new_active := (NEW.deleted_at IS NULL);

    -- Folder changed
    IF OLD.folder_id IS DISTINCT FROM NEW.folder_id THEN
      IF OLD.folder_id IS NOT NULL AND v_old_active THEN
        UPDATE public.folders SET item_count = GREATEST(0, COALESCE(item_count, 1) - 1) WHERE id = OLD.folder_id;
      END IF;
      IF NEW.folder_id IS NOT NULL AND v_new_active THEN
        UPDATE public.folders SET item_count = COALESCE(item_count, 0) + 1 WHERE id = NEW.folder_id;
      END IF;
    -- Soft-delete status changed
    ELSIF v_old_active <> v_new_active AND NEW.folder_id IS NOT NULL THEN
      IF v_new_active THEN
        UPDATE public.folders SET item_count = COALESCE(item_count, 0) + 1 WHERE id = NEW.folder_id;
      ELSE
        UPDATE public.folders SET item_count = GREATEST(0, COALESCE(item_count, 1) - 1) WHERE id = NEW.folder_id;
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_folder_item_count ON public.resources;
CREATE TRIGGER trg_update_folder_item_count
AFTER INSERT OR DELETE OR UPDATE OF folder_id, deleted_at ON public.resources
FOR EACH ROW EXECUTE FUNCTION public.update_folder_item_count();

-- 4.2 Trigger function: Prevent duplicated relational fields in JSON data
CREATE OR REPLACE FUNCTION public.strip_duplicate_data_keys()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.data IS NOT NULL THEN
    NEW.data := NEW.data - 'folderId' - 'ownerId' - 'orgId' - 'organizationId' - 'memberIds' - 'folderIds';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_strip_duplicate_keys_resources ON public.resources;
CREATE TRIGGER trg_strip_duplicate_keys_resources
BEFORE INSERT OR UPDATE ON public.resources
FOR EACH ROW EXECUTE FUNCTION public.strip_duplicate_data_keys();

DROP TRIGGER IF EXISTS trg_strip_duplicate_keys_folders ON public.folders;
CREATE TRIGGER trg_strip_duplicate_keys_folders
BEFORE INSERT OR UPDATE ON public.folders
FOR EACH ROW EXECUTE FUNCTION public.strip_duplicate_data_keys();

DROP TRIGGER IF EXISTS trg_strip_duplicate_keys_groups ON public.groups;
CREATE TRIGGER trg_strip_duplicate_keys_groups
BEFORE INSERT OR UPDATE ON public.groups
FOR EACH ROW EXECUTE FUNCTION public.strip_duplicate_data_keys();

-- ====================================================================
-- 5. REALTIME PUBLICATION FOR WEBSOCKET SYNC
-- ====================================================================
-- Enable REPLICA IDENTITY FULL so UPDATE and DELETE events include full previous row
-- data, enabling client-side filters (owner_id, user_id, recipient_id, email).
ALTER TABLE public.users REPLICA IDENTITY FULL;
ALTER TABLE public.organizations REPLICA IDENTITY FULL;
ALTER TABLE public.organization_members REPLICA IDENTITY FULL;
ALTER TABLE public.folders REPLICA IDENTITY FULL;
ALTER TABLE public.resources REPLICA IDENTITY FULL;
ALTER TABLE public.resource_shares REPLICA IDENTITY FULL;
ALTER TABLE public.groups REPLICA IDENTITY FULL;
ALTER TABLE public.group_members REPLICA IDENTITY FULL;
ALTER TABLE public.group_folders REPLICA IDENTITY FULL;
ALTER TABLE public.activity_logs REPLICA IDENTITY FULL;

DO $$
BEGIN
    -- Ensure publication exists
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;

    -- Add tables to realtime publication if not already present
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'resources') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.resources;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'resource_shares') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.resource_shares;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'folders') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.folders;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'users') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'groups') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.groups;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'group_members') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'group_folders') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.group_folders;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'organizations') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.organizations;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'organization_members') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.organization_members;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'activity_logs') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;
    END IF;
END $$;

-- ====================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 6.1 Users RLS Policies
DROP POLICY IF EXISTS "Users can view profiles and public keys" ON public.users;
CREATE POLICY "Users can view profiles and public keys" ON public.users
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
CREATE POLICY "Users can insert own profile" ON public.users
    FOR INSERT WITH CHECK (
        auth_id = auth.uid()
        OR auth.uid() IS NULL -- Allowed for initial anon onboarding / registration flow
    );

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (
        auth_id = auth.uid()
        OR id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

DROP POLICY IF EXISTS "Users can delete own profile" ON public.users;
CREATE POLICY "Users can delete own profile" ON public.users
    FOR DELETE USING (
        auth_id = auth.uid()
        OR id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

-- 6.2 Organizations & Members RLS Policies
DROP POLICY IF EXISTS "Organizations scoped SELECT" ON public.organizations;
CREATE POLICY "Organizations scoped SELECT" ON public.organizations
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Organizations scoped INSERT" ON public.organizations;
CREATE POLICY "Organizations scoped INSERT" ON public.organizations
    FOR INSERT WITH CHECK (
        owner_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR auth.uid() IS NULL
    );

DROP POLICY IF EXISTS "Organizations scoped UPDATE" ON public.organizations;
CREATE POLICY "Organizations scoped UPDATE" ON public.organizations
    FOR UPDATE USING (
        owner_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

DROP POLICY IF EXISTS "Organizations scoped DELETE" ON public.organizations;
CREATE POLICY "Organizations scoped DELETE" ON public.organizations
    FOR DELETE USING (
        owner_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    );

DROP POLICY IF EXISTS "Organization members scoped ALL" ON public.organization_members;
CREATE POLICY "Organization members scoped ALL" ON public.organization_members
    FOR ALL USING (
        user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = organization_members.organization_id
            AND om.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        )
        OR auth.uid() IS NULL
    );

-- 6.3 Resources RLS Policies (Scoped to Owner OR Recipient)
DROP POLICY IF EXISTS "Resources scoped SELECT" ON public.resources;
CREATE POLICY "Resources scoped SELECT" ON public.resources
    FOR SELECT USING (
        owner_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.resource_shares rs
            WHERE rs.resource_id = resources.id
            AND rs.recipient_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        )
        OR (
            organization_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.organization_id = resources.organization_id
                AND om.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
            )
        )
        OR auth.uid() IS NULL
    );

DROP POLICY IF EXISTS "Resources scoped INSERT" ON public.resources;
CREATE POLICY "Resources scoped INSERT" ON public.resources
    FOR INSERT WITH CHECK (
        owner_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR auth.uid() IS NULL
    );

DROP POLICY IF EXISTS "Resources scoped UPDATE" ON public.resources;
CREATE POLICY "Resources scoped UPDATE" ON public.resources
    FOR UPDATE USING (
        owner_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.resource_shares rs
            WHERE rs.resource_id = resources.id
            AND rs.recipient_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
            AND rs.permission = 'write'
        )
        OR auth.uid() IS NULL
    );

DROP POLICY IF EXISTS "Resources scoped DELETE" ON public.resources;
CREATE POLICY "Resources scoped DELETE" ON public.resources
    FOR DELETE USING (
        owner_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR auth.uid() IS NULL
    );

-- 6.4 Resource Shares RLS Policies
DROP POLICY IF EXISTS "Resource shares scoped SELECT" ON public.resource_shares;
CREATE POLICY "Resource shares scoped SELECT" ON public.resource_shares
    FOR SELECT USING (
        shared_by = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR recipient_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR auth.uid() IS NULL
    );

DROP POLICY IF EXISTS "Resource shares scoped INSERT" ON public.resource_shares;
CREATE POLICY "Resource shares scoped INSERT" ON public.resource_shares
    FOR INSERT WITH CHECK (
        shared_by = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR auth.uid() IS NULL
    );

DROP POLICY IF EXISTS "Resource shares scoped DELETE" ON public.resource_shares;
CREATE POLICY "Resource shares scoped DELETE" ON public.resource_shares
    FOR DELETE USING (
        shared_by = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR recipient_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR auth.uid() IS NULL
    );

-- 6.5 Folders RLS Policies
DROP POLICY IF EXISTS "Folders scoped ALL" ON public.folders;
CREATE POLICY "Folders scoped ALL" ON public.folders
    FOR ALL USING (
        owner_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR (
            organization_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.organization_id = folders.organization_id
                AND om.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
            )
        )
        OR auth.uid() IS NULL
    );

-- 6.6 Groups and Membership RLS Policies
DROP POLICY IF EXISTS "Groups scoped ALL" ON public.groups;
CREATE POLICY "Groups scoped ALL" ON public.groups
    FOR ALL USING (
        created_by = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR owner_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR (
            organization_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.organization_id = groups.organization_id
                AND om.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
            )
        )
        OR auth.uid() IS NULL
    );

DROP POLICY IF EXISTS "Group members scoped ALL" ON public.group_members;
CREATE POLICY "Group members scoped ALL" ON public.group_members
    FOR ALL USING (
        user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.groups g
            WHERE g.id = group_members.group_id
            AND (
                g.created_by = (SELECT id FROM public.users WHERE auth_id = auth.uid())
                OR (
                    g.organization_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM public.organization_members om
                        WHERE om.organization_id = g.organization_id
                        AND om.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
                    )
                )
            )
        )
        OR auth.uid() IS NULL
    );

DROP POLICY IF EXISTS "Group folders scoped ALL" ON public.group_folders;
CREATE POLICY "Group folders scoped ALL" ON public.group_folders
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.groups g
            WHERE g.id = group_folders.group_id
            AND (
                g.created_by = (SELECT id FROM public.users WHERE auth_id = auth.uid())
                OR (
                    g.organization_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM public.organization_members om
                        WHERE om.organization_id = g.organization_id
                        AND om.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
                    )
                )
            )
        )
        OR auth.uid() IS NULL
    );

DROP POLICY IF EXISTS "Team members scoped ALL" ON public.team_members;
CREATE POLICY "Team members scoped ALL" ON public.team_members
    FOR ALL USING (
        user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR auth.uid() IS NULL
    );

-- 6.7 Activity Logs RLS Policies
DROP POLICY IF EXISTS "Activity logs scoped ALL" ON public.activity_logs;
CREATE POLICY "Activity logs scoped ALL" ON public.activity_logs
    FOR ALL USING (
        user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR (
            organization_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.organization_id = activity_logs.organization_id
                AND om.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
            )
        )
        OR auth.uid() IS NULL
    );
