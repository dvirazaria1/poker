-- fresh-start-2026-10-05.sql -- the owner's "delete all history, start over".
-- Empties every app table EXCEPT profiles (the accounts). Run by the owner in the SQL editor.
-- TRUNCATE without CASCADE: if any table outside this list still references one of these, the
-- statement fails instead of silently reaching further. Row triggers (the closed-game
-- immutability guards) do not fire on TRUNCATE.
-- Paired with DATA_EPOCH = 1 in kupa-sgura.html (v79), which empties each device's local copy
-- once so no phone pushes the old data back up.
BEGIN;
TRUNCATE debts, transfers, entries, game_participants, games,
         invites, friend_invites, friendships, group_members, groups, guests;
COMMIT;

SELECT (SELECT count(*) FROM games) AS games, (SELECT count(*) FROM groups) AS groups,
       (SELECT count(*) FROM guests) AS guests, (SELECT count(*) FROM debts) AS debts,
       (SELECT count(*) FROM profiles) AS profiles;
