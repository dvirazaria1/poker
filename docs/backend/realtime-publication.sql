-- realtime-publication.sql -- let the home screens update live (APPLIED 2026-10-05)
--
-- Only games, game_participants and entries are in the supabase_realtime publication (checked
-- 2026-10-05), so a phone hears about a game opening or closing, but not about a new member, a
-- friend request, or a debt. Adding these tables lets the client's account channel
-- (CLOUD_ACCOUNT_TABLES in kupa-sgura.html) listen to them too. Realtime postgres_changes applies
-- each subscriber's RLS SELECT policies, so nobody receives a row they could not already read.
-- After applying, add the same table names to CLOUD_ACCOUNT_TABLES -- never before: a channel
-- that names an unpublished table fails as a whole.
ALTER PUBLICATION supabase_realtime ADD TABLE groups, group_members, friendships, debts;

SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1;
