-- =====================================================================
-- "סוגרים קופה" — group-soft-delete.sql
--
-- APPLIED 2026-10-08 with the owner's approval. Checked live, in a transaction
-- that was rolled back, as the admin of the group the owner was deleting:
-- before, the UPDATE failed 42501 exactly as in the logs; after, it passed.
--
-- WHAT THIS IS
-- Deleting a group never reached the server. The owner deleted a group,
-- left the app, came back, and the group was there again — every time.
--
-- Deletion is a soft column: the client sets groups.deleted_at with a plain
-- UPDATE ... WHERE id = <id> (groups_update_admin allows it for an admin).
-- But the only SELECT policy on groups hides deleted rows:
--
--   CREATE POLICY groups_select_members ON groups FOR SELECT TO authenticated
--     USING (deleted_at IS NULL AND (app_is_active_group_member(id)
--                                    OR created_by_profile_id = app_current_profile_id()));
--
-- An UPDATE with a WHERE clause needs read access to the row, so PostgreSQL
-- also checks the NEW row against the SELECT policies. The new row has
-- deleted_at set, no SELECT policy can see it, and the write is refused:
--
--   postgres_logs 2026-10-08 10:42 .. 11:13 UTC, every attempt:
--     new row violates row-level security policy for table "groups"
--   edge_logs, same times: PATCH /rest/v1/groups?id=eq.<id> -> 403
--
-- The client then sets the refused row aside, the next pull brings the
-- server's copy (deleted_at NULL) back, and the group reappears. Archiving
-- works because archived_at is not in the SELECT policy.
--
-- THE FIX
-- A second, permissive SELECT policy: a group's active admin can still read
-- the group after it is deleted. Permissive policies are OR-ed, so the
-- admin's soft delete passes; nobody else's visibility changes (members keep
-- groups_select_members, deleted groups stay hidden from them). The admin's
-- pull now carries the group with deleted_at set, which the client already
-- filters out of every list (activeGroups / getGroupSummaries), so the
-- admin's other devices learn about the deletion instead of resurrecting it.
--
-- It is idempotent and transactional.
-- =====================================================================

BEGIN;

DROP POLICY IF EXISTS groups_select_admin ON groups;
CREATE POLICY groups_select_admin ON groups FOR SELECT TO authenticated
  USING (app_is_group_admin(id));

COMMIT;

-- ---------------------------------------------------------------------
-- VERIFY (read-only)
-- 1) Both SELECT policies exist:
--      SELECT policyname, qual FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'groups' AND cmd = 'SELECT';
-- 2) In the app, as the group's admin: מחק קבוצה, then reopen the app.
--    The group stays gone, and edge_logs shows the PATCH answered 204.
-- ---------------------------------------------------------------------
