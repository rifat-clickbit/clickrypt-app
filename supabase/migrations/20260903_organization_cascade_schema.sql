-- Migration: 20260903_organization_cascade_schema.sql
-- Description: Explicit Organization and Organization Members schema with managed account cascade relationships.

-- 1. Organizations Table
CREATE TABLE IF NOT EXISTS public.organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    owner_id TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    data JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON public.organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_organizations_domain ON public.organizations(domain);

-- 2. Organization Members Table
CREATE TABLE IF NOT EXISTS public.organization_members (
    id TEXT PRIMARY KEY DEFAULT ('om-' || substr(gen_random_uuid()::text, 1, 12)),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'Member',
    is_managed_account BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'active',
    invited_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    data JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT uq_organization_user UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON public.organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_is_managed ON public.organization_members(is_managed_account);

-- 3. Enhance public.users with organization relations & foreign keys
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'Member' NOT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Active' NOT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS managed_by_organization_id TEXT REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_managed_by_org ON public.users(managed_by_organization_id);
CREATE INDEX IF NOT EXISTS idx_users_org_id ON public.users(organization_id);

-- 4. Enhance resources, folders, groups, and logs with organization_id & foreign keys
ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_resources_org_id ON public.resources(organization_id);
CREATE INDEX IF NOT EXISTS idx_folders_org_id ON public.folders(organization_id);
CREATE INDEX IF NOT EXISTS idx_groups_org_id ON public.groups(organization_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_org_id ON public.activity_logs(organization_id);
