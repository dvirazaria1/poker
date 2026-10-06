-- =====================================================================
-- "סוגרים קופה" — invites-any-member.sql
--
-- DECIDED 2026-10-06: the owner chose A (any active member may invite). Applied the same day.
--
-- WHAT THIS IS
-- The app and the database disagree about who may create a group invite,
-- and the disagreement is what broke joining for the owner's friends:
--
--   DESIGN.md, group-settings overlay:
--     "(1) 'הזמנה לקבוצה' — גלוי לכל חבר פעיל; (2) 'הוספת חבר' — למנהלים בלבד"
--   docs/superpowers/plans/2026-09-08-pre-backend-gaps.md line 33:
--     "כל חבר יכול לשתף הזמנה ... ביטול = admin בלבד"
--
--   docs/backend/rls-policies.sql, as applied:
--     CREATE POLICY invites_insert_admin ON invites FOR INSERT TO authenticated
--       WITH CHECK (app_is_group_admin(group_id) AND created_by_profile_id = app_current_profile_id());
--
-- So a non-admin member tapped "צור הזמנה", the app created the invite
-- locally and rendered a code, a link and a QR for it — and the push was
-- refused 42501. The invite never existed on the server, so the link and
-- the QR pointed at a token nobody could redeem, and the sync dot went red.
-- One cause, all three symptoms.
--
-- SHIPPED RIGHT NOW (v73): the client no longer offers invite creation to a
-- non-admin, so nobody is handed a dead link any more. That stops the
-- bleeding but it also takes away a capability the design deliberately gave
-- every active member.
--
-- THE CHOICE
--   A. Run this file. Any ACTIVE member may create an invite, matching
--      DESIGN.md. Revoking stays admin-only, unchanged. The client guard
--      added in v73 should then be removed (tests/invites.test.cjs pins it).
--      Consequence: any member can bring someone new into the group.
--   B. Do not run it. Invites stay admin-only, and DESIGN.md plus the
--      gap-analysis line above should be corrected to say so, since they
--      currently promise otherwise.
--
-- This file implements A. It is idempotent and transactional.
-- =====================================================================

BEGIN;

-- Same shape as before, with app_is_group_admin widened to active membership.
-- created_by_profile_id = app_current_profile_id() is kept: an invite still records who really
-- made it, and nobody can forge another member's name onto one. Revoking remains
-- invites_update_admin, untouched.
--
-- Revised 2026-10-06 before applying: the original draft (written before link-guest.sql) dropped
-- the guest-binding guard. It is kept here, short-circuited for the common unbound invite:
-- app_guest_bindable_to_invite answers false for anyone who is not an admin of the group
-- (invite-helper-grant.sql), so binding an invite to a guest stays admin-only while a plain
-- invite is open to every active member.
DROP POLICY IF EXISTS invites_insert_admin ON invites;
DROP POLICY IF EXISTS invites_insert_member ON invites;
CREATE POLICY invites_insert_member ON invites FOR INSERT TO authenticated
  WITH CHECK (
    app_is_active_group_member(group_id)
    AND created_by_profile_id = app_current_profile_id()
    AND (bound_guest_id IS NULL OR app_guest_bindable_to_invite(bound_guest_id, group_id))
  );

COMMIT;

SELECT polname, pg_get_expr(polwithcheck, polrelid) AS with_check
  FROM pg_policy WHERE polrelid = 'invites'::regclass AND polcmd = 'a';
