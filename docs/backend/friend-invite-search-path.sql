-- friend-invite-search-path.sql -- every new personal friend link failed (NOT YET APPLIED)
--
-- app_create_friend_invite() mints its token with gen_random_bytes(), which on Supabase lives in
-- the `extensions` schema (pgcrypto). The function pins `SET search_path = public`, so the call
-- resolves to nothing: 42883 "function gen_random_bytes(integer) does not exist" for anyone who
-- does not already own a friend_invites row -- after the 2026-10-05 fresh start, everyone.
-- Verified read-only on 2026-10-05: pg_proc shows gen_random_bytes in `extensions` and the
-- function's proconfig = {search_path=public}.
--
-- Fix: add `extensions` to that one function's search path. Nothing else changes.
ALTER FUNCTION public.app_create_friend_invite() SET search_path = public, extensions;

-- Check: expect {"search_path=public, extensions"}.
SELECT proconfig FROM pg_proc WHERE proname = 'app_create_friend_invite';
