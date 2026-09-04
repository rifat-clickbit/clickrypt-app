-- ClickRypt Supabase Schema Remediation & Relationship Migration
-- Guiding Principles:
-- 1. 100% Idempotent execution (runs cleanly on fresh or existing databases).
-- 2. Single source of truth in relational columns.
-- 3. Complete foreign keys with ON DELETE CASCADE / SET NULL enforce database integrity.
-- 4. Trigger safety net strips duplicate keys from data JSONB without deleting un-migrated keys.
-- 5. Automatic folder item_count triggers eliminate counter drift, including soft-deletion.
-- 6. Add all active tables to realtime publication.

BEGIN;

-- ============================================================================
-- 1. Ensure Missing Tables & Base Structures Exist
-- ============================================================================

-- Ensure organizations table exists before any ALTER statements
CREATE TABLE IF NOT EXISTS public.organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    owner_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    data JSONB DEFAULT '{}'::jsonb
);

-- Ensure users table has all required relational columns
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'Member' NOT NULL,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Active' NOT NULL,
  ADD COLUMN IF NOT EXISTS organization_id TEXT,
  ADD COLUMN IF NOT EXISTS managed_by_organization_id TEXT;

-- Ensure folders table has required columns before backfill
ALTER TABLE public.folders
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS item_count INTEGER DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS last_modified TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- Ensure resources table has required columns before backfill
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'login',
  ADD COLUMN IF NOT EXISTS secrets_data JSONB,
  ADD COLUMN IF NOT EXISTS encrypted_data TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_symmetric_key TEXT,
  ADD COLUMN IF NOT EXISTS is_private_only BOOLEAN DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS last_modified TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- Ensure groups table has required columns
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS owner_id TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- Ensure group_members table has role column
ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'Member' NOT NULL;

-- Ensure activity_logs table has all columns
ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS action TEXT,
  ADD COLUMN IF NOT EXISTS user_email TEXT,
  ADD COLUMN IF NOT EXISTS details JSONB,
  ADD COLUMN IF NOT EXISTS organization_id TEXT,
  ADD COLUMN IF NOT EXISTS resource_id TEXT,
  ADD COLUMN IF NOT EXISTS group_id TEXT;

-- Ensure organization_members table exists with unified primary key and unique constraint
CREATE TABLE IF NOT EXISTS public.organization_members (
  id TEXT PRIMARY KEY DEFAULT ('om-' || substr(gen_random_uuid()::text, 1, 12)),
  organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES public.users(id)         ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'Member',
  is_managed_account BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'active',
  invited_by      TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  data            JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT uq_organization_user UNIQUE (organization_id, user_id)
);

-- If organization_members was created in earlier migration without id column:
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organization_members' AND column_name = 'id'
  ) THEN
    ALTER TABLE public.organization_members
      ADD COLUMN id TEXT DEFAULT ('om-' || substr(gen_random_uuid()::text, 1, 12));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organization_members' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE public.organization_members
      ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- Enable RLS on organization_members
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. Orphan Record Cleanup (Required before applying strict Foreign Keys)
-- ============================================================================
DELETE FROM public.resource_shares
WHERE resource_id NOT IN (SELECT id FROM public.resources)
   OR recipient_id NOT IN (SELECT id FROM public.users)
   OR shared_by NOT IN (SELECT id FROM public.users);

DELETE FROM public.group_members
WHERE group_id NOT IN (SELECT id FROM public.groups)
   OR user_id NOT IN (SELECT id FROM public.users);

DELETE FROM public.group_folders
WHERE group_id NOT IN (SELECT id FROM public.groups)
   OR folder_id NOT IN (SELECT id FROM public.folders);

DELETE FROM public.organization_members
WHERE organization_id NOT IN (SELECT id FROM public.organizations)
   OR user_id NOT IN (SELECT id FROM public.users);

UPDATE public.resources
SET folder_id = NULL
WHERE folder_id IS NOT NULL AND folder_id NOT IN (SELECT id FROM public.folders);

UPDATE public.resources
SET organization_id = NULL
WHERE organization_id IS NOT NULL AND organization_id NOT IN (SELECT id FROM public.organizations);

UPDATE public.folders
SET organization_id = NULL
WHERE organization_id IS NOT NULL AND organization_id NOT IN (SELECT id FROM public.organizations);

UPDATE public.groups
SET organization_id = NULL
WHERE organization_id IS NOT NULL AND organization_id NOT IN (SELECT id FROM public.organizations);

UPDATE public.users
SET organization_id = NULL
WHERE organization_id IS NOT NULL AND organization_id NOT IN (SELECT id FROM public.organizations);

UPDATE public.users
SET managed_by_organization_id = NULL
WHERE managed_by_organization_id IS NOT NULL AND managed_by_organization_id NOT IN (SELECT id FROM public.organizations);

-- ============================================================================
-- 3. Reconcile, Backfill & Strip Duplicate JSONB Keys
-- ============================================================================

-- Backfill organizations
UPDATE public.organizations
SET owner_id   = COALESCE(owner_id, data->>'ownerId'),
    name       = COALESCE(name, data->>'name', 'Organization'),
    created_at = COALESCE(created_at, (data->>'createdAt')::timestamptz, now())
WHERE name IS NULL OR owner_id IS NULL;

-- Backfill users columns from data JSONB
UPDATE public.users
SET role                    = COALESCE(role, data->>'role', 'Member'),
    status                  = COALESCE(status, data->>'status', 'Active'),
    organization_id         = COALESCE(organization_id, data->>'orgId', data->>'organizationId'),
    managed_by_organization_id = COALESCE(managed_by_organization_id, data->>'managedByOrganizationId')
WHERE role IS NULL OR status IS NULL;

-- Backfill resources columns from data JSONB
UPDATE public.resources
SET folder_id        = COALESCE(folder_id, data->>'folderId'),
    owner_id         = COALESCE(owner_id,  data->>'ownerId'),
    name             = COALESCE(name,      data->>'name', data->>'title', 'Untitled Item'),
    organization_id  = COALESCE(organization_id, data->>'orgId', data->>'organizationId')
WHERE folder_id IS NULL OR owner_id IS NULL OR name IS NULL;

-- Backfill folders columns from data JSONB
UPDATE public.folders
SET owner_id        = COALESCE(owner_id, data->>'ownerId'),
    name            = COALESCE(name, data->>'name', 'Untitled Folder'),
    description     = COALESCE(description, data->>'description'),
    color           = COALESCE(color, data->>'color', '#FBBF24'),
    organization_id = COALESCE(organization_id, data->>'orgId', data->>'organizationId')
WHERE name IS NULL OR owner_id IS NULL;

-- Backfill groups columns from data JSONB
UPDATE public.groups
SET name            = COALESCE(name, data->>'name', 'Group'),
    description     = COALESCE(description, data->>'description'),
    organization_id = COALESCE(organization_id, data->>'orgId', data->>'organizationId'),
    created_by      = COALESCE(created_by, owner_id, data->>'createdBy')
WHERE name IS NULL;

-- Clean redundant keys out of JSON data
UPDATE public.resources SET data = data - 'folderId' - 'ownerId' - 'orgId' - 'organizationId' WHERE data IS NOT NULL;
UPDATE public.folders   SET data = data - 'orgId' - 'organizationId' WHERE data IS NOT NULL;
UPDATE public.groups    SET data = data - 'orgId' - 'organizationId' - 'memberIds' - 'folderIds' WHERE data IS NOT NULL;

-- ============================================================================
-- 4. Add All Missing Foreign Key Constraints (with Cascade / Set Null)
-- ============================================================================
DO $$ BEGIN
  -- users -> auth.users
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_auth_id_fkey') THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_auth_id_fkey FOREIGN KEY (auth_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- users -> organizations
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_organization') THEN
    ALTER TABLE public.users
      ADD CONSTRAINT fk_users_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_managed_by_org') THEN
    ALTER TABLE public.users
      ADD CONSTRAINT fk_users_managed_by_org FOREIGN KEY (managed_by_organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;

  -- organizations -> users (owner)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_owner_id_fkey') THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;
  END IF;

  -- resources -> users
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resources_owner_id_fkey') THEN
    ALTER TABLE public.resources
      ADD CONSTRAINT resources_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;

  -- resources -> folders
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resources_folder_id_fkey') THEN
    ALTER TABLE public.resources
      ADD CONSTRAINT resources_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;
  END IF;

  -- resources -> organizations
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resources_organization_id_fkey') THEN
    ALTER TABLE public.resources
      ADD CONSTRAINT resources_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  -- folders -> users
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'folders_owner_id_fkey') THEN
    ALTER TABLE public.folders
      ADD CONSTRAINT folders_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;

  -- folders -> organizations
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'folders_organization_id_fkey') THEN
    ALTER TABLE public.folders
      ADD CONSTRAINT folders_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  -- resource_shares -> resources
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shares_resource_id_fkey') AND
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_shares_resource_id_fkey') THEN
    ALTER TABLE public.resource_shares
      ADD CONSTRAINT shares_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.resources(id) ON DELETE CASCADE;
  END IF;

  -- resource_shares -> users (recipient)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shares_recipient_id_fkey') AND
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_shares_recipient_id_fkey') THEN
    ALTER TABLE public.resource_shares
      ADD CONSTRAINT shares_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;

  -- resource_shares -> users (shared_by)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shares_shared_by_fkey') AND
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_shares_shared_by_fkey') THEN
    ALTER TABLE public.resource_shares
      ADD CONSTRAINT shares_shared_by_fkey FOREIGN KEY (shared_by) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;

  -- groups -> users (created_by)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_created_by_fkey') THEN
    ALTER TABLE public.groups
      ADD CONSTRAINT groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  -- groups -> users (owner_id)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_owner_id_fkey') THEN
    ALTER TABLE public.groups
      ADD CONSTRAINT groups_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  -- groups -> organizations
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_organization_id_fkey') THEN
    ALTER TABLE public.groups
      ADD CONSTRAINT groups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  -- group_members -> groups
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gm_group_id_fkey') AND
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_members_group_id_fkey') THEN
    ALTER TABLE public.group_members
      ADD CONSTRAINT gm_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;
  END IF;

  -- group_members -> users
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gm_user_id_fkey') AND
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_members_user_id_fkey') THEN
    ALTER TABLE public.group_members
      ADD CONSTRAINT gm_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;

  -- group_folders -> groups
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gf_group_id_fkey') AND
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_folders_group_id_fkey') THEN
    ALTER TABLE public.group_folders
      ADD CONSTRAINT gf_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;
  END IF;

  -- group_folders -> folders
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gf_folder_id_fkey') AND
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_folders_folder_id_fkey') THEN
    ALTER TABLE public.group_folders
      ADD CONSTRAINT gf_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE CASCADE;
  END IF;

  -- activity_logs -> users
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logs_user_id_fkey') AND
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_logs_user_id_fkey') THEN
    ALTER TABLE public.activity_logs
      ADD CONSTRAINT logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  -- activity_logs -> organizations
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logs_org_id_fkey') THEN
    ALTER TABLE public.activity_logs
      ADD CONSTRAINT logs_org_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  -- activity_logs -> resources
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logs_resource_id_fkey') THEN
    ALTER TABLE public.activity_logs
      ADD CONSTRAINT logs_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.resources(id) ON DELETE SET NULL;
  END IF;

  -- activity_logs -> groups
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logs_group_id_fkey') THEN
    ALTER TABLE public.activity_logs
      ADD CONSTRAINT logs_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- 5. Trigger Safety Net & Views
-- ============================================================================
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

-- Relational Group Membership View
CREATE OR REPLACE VIEW public.groups_with_members AS
SELECT
  g.*,
  COALESCE((SELECT json_agg(gm.user_id) FROM public.group_members gm WHERE gm.group_id = g.id), '[]'::json) AS member_ids,
  COALESCE((SELECT json_agg(gf.folder_id) FROM public.group_folders gf WHERE gf.group_id = g.id), '[]'::json) AS folder_ids,
  COALESCE((SELECT count(*)::int FROM public.group_members gm WHERE gm.group_id = g.id), 0) AS member_count
FROM public.groups g;

-- Automatic Folder item_count Trigger (including soft delete support)
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

    IF OLD.folder_id IS DISTINCT FROM NEW.folder_id THEN
      IF OLD.folder_id IS NOT NULL AND v_old_active THEN
        UPDATE public.folders SET item_count = GREATEST(0, COALESCE(item_count, 1) - 1) WHERE id = OLD.folder_id;
      END IF;
      IF NEW.folder_id IS NOT NULL AND v_new_active THEN
        UPDATE public.folders SET item_count = COALESCE(item_count, 0) + 1 WHERE id = NEW.folder_id;
      END IF;
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

-- One-time reconciliation for accurate item counts
UPDATE public.folders f
SET item_count = (
  SELECT count(*) FROM public.resources r
  WHERE r.folder_id = f.id AND r.deleted_at IS NULL
);

-- ============================================================================
-- 6. Ensure Tables Added to Realtime Publication & Enable Full Replication
-- ============================================================================
-- Enable REPLICA IDENTITY FULL so UPDATE and DELETE events broadcast full previous
-- row data, enabling column filters (owner_id, user_id, recipient_id, email).
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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

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

COMMIT;
