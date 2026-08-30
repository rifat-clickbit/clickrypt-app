-- ====================================================================
-- CLICKRYPT ADVANCED ZERO-KNOWLEDGE SUPABASE DATABASE SCHEMA
-- Normalized relational architecture with Row Level Security (RLS)
-- ====================================================================

-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Create 'users' table (Profiles & OpenPGP RSA Public Keys)
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    auth_id UUID,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    account_mode TEXT DEFAULT 'personal' NOT NULL,
    avatar_url TEXT,
    public_key TEXT,
    encrypted_private_key TEXT,
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret TEXT,
    data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create 'folders' table (Vault Categories)
CREATE TABLE IF NOT EXISTS public.folders (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#FBBF24',
    mode TEXT DEFAULT 'personal' NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create 'resources' table (Encrypted Vault Credentials)
CREATE TABLE IF NOT EXISTS public.resources (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES public.folders(id) ON DELETE SET NULL,
    mode TEXT DEFAULT 'personal' NOT NULL,
    item_type TEXT DEFAULT 'login' NOT NULL,
    data JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Create 'resource_shares' table (Passbolt-style Asymmetric ZK Sharing)
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

-- 5. Create 'groups' table (Access Control Groups)
CREATE TABLE IF NOT EXISTS public.groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    mode TEXT DEFAULT 'organization' NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Create 'group_members' join table
CREATE TABLE IF NOT EXISTS public.group_members (
    group_id TEXT NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

-- 7. Create 'group_folders' join table
CREATE TABLE IF NOT EXISTS public.group_folders (
    group_id TEXT NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    folder_id TEXT NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (group_id, folder_id)
);

-- 8. Create 'team_members' table (Organization Roster)
CREATE TABLE IF NOT EXISTS public.team_members (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'Member' NOT NULL,
    status TEXT DEFAULT 'Active' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. Create 'activity_logs' table (Audit Logging)
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    email_snapshot TEXT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    category TEXT DEFAULT 'vault' NOT NULL,
    mode TEXT DEFAULT 'personal' NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ====================================================================
-- INDEXES FOR HIGH-SPEED LOOKUPS & INTEGRITY
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_resources_owner_id ON public.resources(owner_id);
CREATE INDEX IF NOT EXISTS idx_resources_folder_id ON public.resources(folder_id);
CREATE INDEX IF NOT EXISTS idx_resources_mode ON public.resources(mode);
CREATE INDEX IF NOT EXISTS idx_resource_shares_lookup ON public.resource_shares(resource_id, recipient_id);
CREATE INDEX IF NOT EXISTS idx_resource_shares_recipient ON public.resource_shares(recipient_id);
CREATE INDEX IF NOT EXISTS idx_folders_owner_id ON public.folders(owner_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON public.group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON public.activity_logs(user_id);

-- ====================================================================
-- REALTIME PUBLICATION FOR WEBSOCKET SYNC
-- ====================================================================
DO $$
BEGIN
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
END $$;

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 1. Users RLS Policies
DROP POLICY IF EXISTS "Users can view profiles and public keys" ON public.users;
CREATE POLICY "Users can view profiles and public keys" ON public.users
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
CREATE POLICY "Users can insert own profile" ON public.users
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth_id = auth.uid() OR auth.uid() IS NULL);

DROP POLICY IF EXISTS "Users can delete own profile" ON public.users;
CREATE POLICY "Users can delete own profile" ON public.users
    FOR DELETE USING (auth_id = auth.uid() OR auth.uid() IS NULL);

-- 2. Resources RLS Policies (Scoped to Owner OR Recipient)
DROP POLICY IF EXISTS "Resources scoped SELECT" ON public.resources;
CREATE POLICY "Resources scoped SELECT" ON public.resources
    FOR SELECT USING (
        owner_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.resource_shares rs
            WHERE rs.resource_id = resources.id
            AND rs.recipient_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
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

-- 3. Resource Shares RLS Policies
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

-- 4. Folders RLS Policies
DROP POLICY IF EXISTS "Folders scoped ALL" ON public.folders;
CREATE POLICY "Folders scoped ALL" ON public.folders
    FOR ALL USING (
        owner_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR auth.uid() IS NULL
    );

-- 5. Groups and Membership RLS
DROP POLICY IF EXISTS "Groups scoped ALL" ON public.groups;
CREATE POLICY "Groups scoped ALL" ON public.groups
    FOR ALL USING (true);

DROP POLICY IF EXISTS "Group members scoped ALL" ON public.group_members;
CREATE POLICY "Group members scoped ALL" ON public.group_members
    FOR ALL USING (true);

DROP POLICY IF EXISTS "Group folders scoped ALL" ON public.group_folders;
CREATE POLICY "Group folders scoped ALL" ON public.group_folders
    FOR ALL USING (true);

DROP POLICY IF EXISTS "Team members scoped ALL" ON public.team_members;
CREATE POLICY "Team members scoped ALL" ON public.team_members
    FOR ALL USING (true);

-- 6. Activity Logs RLS Policies
DROP POLICY IF EXISTS "Activity logs scoped ALL" ON public.activity_logs;
CREATE POLICY "Activity logs scoped ALL" ON public.activity_logs
    FOR ALL USING (
        user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        OR auth.uid() IS NULL
    );
