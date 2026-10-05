-- =====================================================================
-- invite-helper-grant.sql -- restores invite creation (NOT YET APPLIED)
--
-- What broke: the follow-up REVOKE at the end of link-guest.sql (applied
-- 2026-09-10) took EXECUTE on app_guest_bindable_to_invite away from
-- `authenticated` as well as from public/anon. But invites_insert_admin
-- calls that function, and a policy expression runs with the privileges
-- of the user doing the INSERT. So since 2026-09-10 every invite INSERT,
-- by any admin, fails with 42501 "permission denied for function
-- app_guest_bindable_to_invite": the share link and QR point at a token
-- the server never stored, and the refused row stays in the outbox, so
-- the sync dot stays red.
--
-- The fix grants EXECUTE back to `authenticated` only, after making the
-- function answer false for any group the caller does not administer, so
-- a direct call cannot be used to ask about other groups' guests (the
-- reason it was revoked). anon/public stay revoked. The only caller is
-- invites_insert_admin (grep docs/backend), whose own check already
-- requires app_is_group_admin(group_id), so the added guard changes no
-- legitimate outcome. Proposed by the 2026-10-05 Codex sync review (9a).
--
-- Verify afterwards, as an admin on the phone: create an invite, the dot
-- turns green, and the link opens the join screen on a second account.
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.app_guest_bindable_to_invite(p_guest_id uuid, p_group_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.app_current_profile_id() IS NULL OR NOT public.app_is_group_admin(p_group_id) THEN
    RETURN false;
  END IF;
  IF p_guest_id IS NULL THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.guests g
    JOIN public.group_members gm
      ON gm.guest_id = g.id AND gm.group_id = p_group_id AND gm.status = 'active'
    WHERE g.id = p_guest_id AND g.linked_profile_id IS NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_guest_bindable_to_invite(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.app_guest_bindable_to_invite(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.app_guest_bindable_to_invite(uuid, uuid) TO authenticated;

COMMIT;

-- Read-only check (run after): expect auth_exec = true, anon_exec = false.
-- SELECT has_function_privilege('authenticated', 'public.app_guest_bindable_to_invite(uuid,uuid)', 'EXECUTE') AS auth_exec,
--        has_function_privilege('anon',          'public.app_guest_bindable_to_invite(uuid,uuid)', 'EXECUTE') AS anon_exec;
