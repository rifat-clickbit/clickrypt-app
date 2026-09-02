-- Add creator tracking to groups so future groups can be safely deleted
-- when their creator's account is deleted. Existing groups are left with
-- created_by = NULL because their true creator is unrecoverable.
ALTER TABLE public.groups
ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_groups_created_by ON public.groups(created_by);
