-- ClickRypt Supabase Schema Remediation Migration
-- Generated: 2026-09-03
-- Guiding Principles:
-- 1. Single source of truth in relational columns.
-- 2. Foreign keys with ON DELETE CASCADE / SET NULL enforce database integrity.
-- 3. Trigger safety net strips duplicate keys from data JSONB.
-- 4. Automatic folder item_count triggers eliminate counter drift.

BEGIN;

-- ============================================================================
-- 1. Problem 3: Orphan Record Cleanup (Required before adding Foreign Keys)
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

UPDATE public.resources
SET folder_id = NULL
WHERE folder_id IS NOT NULL AND folder_id NOT IN (SELECT id FROM public.folders);

-- ============================================================================
-- 2. Problem 5: Organizations & Organization Members Table Setup
-- ============================================================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS owner_id text,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

UPDATE public.organizations
SET owner_id   = COALESCE(owner_id, data->>'ownerId'),
    name       = COALESCE(name, data->>'name', 'Organization'),
    created_at = COALESCE(created_at, (data->>'createdAt')::timestamptz, now())
WHERE name IS NULL OR owner_id IS NULL;

CREATE TABLE IF NOT EXISTS public.organization_members (
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         text NOT NULL REFERENCES public.users(id)         ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'Member',
  is_managed_account boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'active',
  invited_by      text REFERENCES public.users(id) ON DELETE SET NULL,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

-- Enable RLS on organization_members
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'organization_members' AND policyname = 'allow_all_authenticated_members'
  ) THEN
    CREATE POLICY allow_all_authenticated_members ON public.organization_members
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================================
-- 3. Problem 7: Activity Logs Missing Columns
-- ============================================================================
ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS user_email text,
  ADD COLUMN IF NOT EXISTS details jsonb;

-- ============================================================================
-- 4. Problem 1: Reconcile, Backfill & Strip Duplicate JSONB Keys
-- ============================================================================
-- Backfill resources columns from data JSONB
UPDATE public.resources
SET folder_id = COALESCE(folder_id, data->>'folderId'),
    owner_id  = COALESCE(owner_id,  data->>'ownerId'),
    name      = COALESCE(name,      data->>'name')
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
    organization_id = COALESCE(organization_id, data->>'orgId', data->>'organizationId')
WHERE name IS NULL;

-- Strip duplicated keys out of data JSONB
UPDATE public.users     SET data = data - 'role' - 'accountMode' WHERE data IS NOT NULL;
UPDATE public.resources SET data = data - 'name' - 'folderId' - 'ownerId' WHERE data IS NOT NULL;
UPDATE public.folders   SET data = data - 'name' - 'description' - 'color' - 'orgId' - 'organizationId' WHERE data IS NOT NULL;
UPDATE public.groups    SET data = data - 'name' - 'description' - 'orgId' - 'organizationId' - 'memberIds' - 'folderIds' WHERE data IS NOT NULL;

-- ============================================================================
-- 5. Trigger Safety Net against duplicate data keys
-- ============================================================================
CREATE OR REPLACE FUNCTION public.strip_duplicate_data_keys()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.data IS NOT NULL THEN
    NEW.data := NEW.data - 'name' - 'role' - 'accountMode' - 'folderId'
                         - 'ownerId' - 'description' - 'color' - 'orgId'
                         - 'organizationId' - 'memberIds' - 'folderIds';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_strip_duplicate_keys_users ON public.users;
CREATE TRIGGER trg_strip_duplicate_keys_users
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.strip_duplicate_data_keys();

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

-- ============================================================================
-- 6. Problem 4: Relational Group Membership View
-- ============================================================================
CREATE OR REPLACE VIEW public.groups_with_members AS
SELECT
  g.*,
  COALESCE((SELECT json_agg(gm.user_id) FROM public.group_members gm WHERE gm.group_id = g.id), '[]'::json) AS member_ids,
  COALESCE((SELECT json_agg(gf.folder_id) FROM public.group_folders gf WHERE gf.group_id = g.id), '[]'::json) AS folder_ids,
  COALESCE((SELECT count(*)::int FROM public.group_members gm WHERE gm.group_id = g.id), 0) AS member_count
FROM public.groups g;

-- ============================================================================
-- 7. Problem 3: Foreign Key Constraints with Cascade / Set Null
-- ============================================================================
DO $$ BEGIN
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

  -- folders -> users
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'folders_owner_id_fkey') THEN
    ALTER TABLE public.folders
      ADD CONSTRAINT folders_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;

  -- resource_shares -> resources & users
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shares_resource_id_fkey') THEN
    ALTER TABLE public.resource_shares
      ADD CONSTRAINT shares_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.resources(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shares_recipient_id_fkey') THEN
    ALTER TABLE public.resource_shares
      ADD CONSTRAINT shares_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shares_shared_by_fkey') THEN
    ALTER TABLE public.resource_shares
      ADD CONSTRAINT shares_shared_by_fkey FOREIGN KEY (shared_by) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;

  -- groups -> users
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_created_by_fkey') THEN
    ALTER TABLE public.groups
      ADD CONSTRAINT groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  -- group_members
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gm_group_id_fkey') THEN
    ALTER TABLE public.group_members
      ADD CONSTRAINT gm_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gm_user_id_fkey') THEN
    ALTER TABLE public.group_members
      ADD CONSTRAINT gm_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;

  -- group_folders
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gf_group_id_fkey') THEN
    ALTER TABLE public.group_folders
      ADD CONSTRAINT gf_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gf_folder_id_fkey') THEN
    ALTER TABLE public.group_folders
      ADD CONSTRAINT gf_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE CASCADE;
  END IF;

  -- activity_logs -> users
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logs_user_id_fkey') THEN
    ALTER TABLE public.activity_logs
      ADD CONSTRAINT logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- 8. Problem 6: Automatic Folder item_count Trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_folder_item_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.folder_id IS NOT NULL THEN
    UPDATE public.folders SET item_count = COALESCE(item_count, 0) + 1 WHERE id = NEW.folder_id;
  ELSIF TG_OP = 'DELETE' AND OLD.folder_id IS NOT NULL THEN
    UPDATE public.folders SET item_count = GREATEST(0, COALESCE(item_count, 1) - 1) WHERE id = OLD.folder_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.folder_id IS DISTINCT FROM NEW.folder_id THEN
    IF OLD.folder_id IS NOT NULL THEN
      UPDATE public.folders SET item_count = GREATEST(0, COALESCE(item_count, 1) - 1) WHERE id = OLD.folder_id;
    END IF;
    IF NEW.folder_id IS NOT NULL THEN
      UPDATE public.folders SET item_count = COALESCE(item_count, 0) + 1 WHERE id = NEW.folder_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_folder_item_count ON public.resources;
CREATE TRIGGER trg_update_folder_item_count
AFTER INSERT OR DELETE OR UPDATE OF folder_id ON public.resources
FOR EACH ROW EXECUTE FUNCTION public.update_folder_item_count();

-- One-time reconciliation for accurate item counts
UPDATE public.folders f
SET item_count = (
  SELECT count(*) FROM public.resources r
  WHERE r.folder_id = f.id AND r.deleted_at IS NULL
);

COMMIT;
