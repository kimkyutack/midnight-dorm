PRAGMA foreign_keys = OFF;

-- SQLite cannot widen a CHECK constraint in place. Rebuild the commercial
-- catalog so tile themes can share the existing purchase and ownership flow.
ALTER TABLE cosmetic_catalog RENAME TO cosmetic_catalog_legacy;

CREATE TABLE cosmetic_catalog (
  id TEXT PRIMARY KEY,
  slot TEXT NOT NULL CHECK (slot IN ('character', 'skin', 'tile', 'turret')),
  character_id TEXT REFERENCES cosmetic_catalog(id),
  turret_kind TEXT,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  symbol TEXT NOT NULL,
  swatch TEXT NOT NULL,
  unlock_kind TEXT NOT NULL CHECK (unlock_kind IN ('starter', 'points', 'rank', 'reward')),
  point_price INTEGER CHECK (point_price IS NULL OR point_price >= 0),
  unlock_rank TEXT,
  trait_multiplier REAL NOT NULL DEFAULT 1 CHECK (trait_multiplier > 0),
  asset_directory TEXT,
  gameplay_json TEXT NOT NULL DEFAULT '{}',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_limited INTEGER NOT NULL DEFAULT 0 CHECK (is_limited IN (0, 1)),
  sale_starts_at INTEGER,
  sale_ends_at INTEGER,
  payment_product_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO cosmetic_catalog (
  id, slot, character_id, turret_kind, label, description, symbol, swatch,
  unlock_kind, point_price, unlock_rank, trait_multiplier, asset_directory,
  gameplay_json, display_order, is_active, is_limited, sale_starts_at,
  sale_ends_at, payment_product_id, created_at, updated_at
)
SELECT
  id, slot, character_id, turret_kind, label, description, symbol, swatch,
  unlock_kind, point_price, unlock_rank, trait_multiplier, asset_directory,
  gameplay_json, display_order, is_active, is_limited, sale_starts_at,
  sale_ends_at, payment_product_id, created_at, updated_at
FROM cosmetic_catalog_legacy;

DROP TABLE cosmetic_catalog_legacy;

CREATE INDEX idx_cosmetic_catalog_listing
  ON cosmetic_catalog(slot, is_active, display_order, id);
CREATE INDEX idx_cosmetic_catalog_character
  ON cosmetic_catalog(character_id, slot, is_active);

INSERT INTO cosmetic_catalog (
  id, slot, character_id, label, description, symbol, swatch,
  unlock_kind, point_price, trait_multiplier, asset_directory, gameplay_json,
  display_order, is_active, is_limited, created_at, updated_at
) VALUES
  (
    'tile-basic-ward', 'tile', NULL, '기본 병동 타일',
    '스테이지 고유의 기본 방 타일을 사용합니다.', '기', '#185f63',
    'starter', NULL, 1, NULL, '{"transition":"none"}',
    10, 1, 0, 1785230400000, 1785230400000
  ),
  (
    'tile-wave-surfer', 'tile', NULL, '파도 타일',
    '침대를 점유하면 파도가 방을 훑으며 시원한 물결 타일로 바뀝니다.',
    '파', '#55dff3', 'points', 1000, 1,
    'skin-wave/wave-tile.webp', '{"transition":"wave-flip-left-to-right"}',
    20, 1, 1, 1785230400000, 1785230400000
  );

INSERT INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.07.28.5',
  '서퍼 몽 테마: 파도 타일',
  '• 상점과 내 보관함에 타일 스킨 탭을 추가했습니다.' || char(10) ||
  '• 침대를 점유하면 파도가 방을 훑고 타일이 뒤집히며 파도 타일로 변경됩니다.' || char(10) ||
  '• 방별 타일 스킨 상태를 서버가 저장해 멀티플레이와 재접속에서도 동일하게 유지합니다.',
  1785230400000
);

PRAGMA foreign_keys = ON;
