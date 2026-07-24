-- A compact, user-selected image is stored as a validated data URL.  The
-- client limits it to a small WebP payload; moving large media to R2 remains
-- a future scaling path.
ALTER TABLE accounts ADD COLUMN profile_avatar TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN profile_avatar_updated_at INTEGER NOT NULL DEFAULT 0;
