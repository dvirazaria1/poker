-- Ending a friendship (owner, 2026-10-08).
-- Either party may delete an ACCEPTED friendship. The existing friendships_delete_requester
-- (the requester withdraws a request that is still pending) is unchanged. The client deletes
-- through cloudDeleteFriendship(); the pull then drops the row on both phones.
-- Idempotent: safe to run more than once.

DROP POLICY IF EXISTS friendships_delete_party ON friendships;
CREATE POLICY friendships_delete_party ON friendships FOR DELETE TO authenticated
  USING (status = 'accepted'
     AND (requester_profile_id = app_current_profile_id()
       OR addressee_profile_id = app_current_profile_id()));
