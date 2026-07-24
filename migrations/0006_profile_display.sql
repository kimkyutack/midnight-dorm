-- Public in-game label selection is intentionally separate from the selected
-- play mode so changing a badge does not change matchmaking or progression.
ALTER TABLE accounts ADD COLUMN profile_display_mode TEXT NOT NULL DEFAULT 'solo';
