CREATE TABLE IF NOT EXISTS hide_seek_room_registry (
  code TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hide_seek_room_registry_created
ON hide_seek_room_registry(created_at DESC);
