-- profile-avatar.sql — OPTIONAL hardening for the profile picture (DESIGN.md "תוספת — תמונת פרופיל").
-- APPLIED to production 2026-10-08 (migration profile_avatar_url_shape): pre-check found 0 violating
-- rows of 4 profiles; verified live -- a malformed value is refused, a valid one accepted (both
-- probes rolled back, no data changed).
-- NOT required for the feature: the client already writes and reads profiles.avatar_url, and every
-- reader runs parseAvatar() before rendering, so a malformed value shows the name's first letter.
--
-- What this adds: the server refuses a value no client would ever write, so one account cannot park
-- a multi-megabyte string (or a non-image) in a column its friends and group-mates download.
-- The shapes mirror parseAvatar() in kupa-sgura.html exactly; keep the two in step.
--
-- Before running: confirm no existing row would violate it —
--   SELECT id, left(avatar_url, 40), length(avatar_url) FROM profiles
--   WHERE avatar_url IS NOT NULL
--     AND NOT (length(avatar_url) <= 32000 AND avatar_url ~ '^(data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}|kupa:suit:(spade|heart|diamond|club):(plain|accent|outline|solid|casino|teal|mold|tricolor|chip)|kupa:cards:(A|K|Q|J|10|[2-9])[shdc](\.(A|K|Q|J|10|[2-9])[shdc])?)$');
-- (expect zero rows), then run the ALTER below. Undo: ALTER TABLE profiles DROP CONSTRAINT profiles_avatar_url_shape;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_avatar_url_shape CHECK (
    avatar_url IS NULL OR (
      length(avatar_url) <= 32000
      AND avatar_url ~ '^(data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}|kupa:suit:(spade|heart|diamond|club):(plain|accent|outline|solid|casino|teal|mold|tricolor|chip)|kupa:cards:(A|K|Q|J|10|[2-9])[shdc](\.(A|K|Q|J|10|[2-9])[shdc])?)$'
    )
  );
