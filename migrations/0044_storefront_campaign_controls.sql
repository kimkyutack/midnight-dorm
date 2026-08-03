PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS promotion_campaigns (
  id TEXT PRIMARY KEY,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_promotion_campaigns_listing
  ON promotion_campaigns(is_visible, sort_order, id);

CREATE TABLE IF NOT EXISTS cosmetic_theme_settings (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  is_store_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_store_visible IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cosmetic_theme_items (
  theme_id TEXT NOT NULL REFERENCES cosmetic_theme_settings(id) ON DELETE CASCADE,
  cosmetic_id TEXT NOT NULL REFERENCES cosmetic_catalog(id) ON DELETE CASCADE,
  item_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (theme_id, cosmetic_id)
);

CREATE INDEX IF NOT EXISTS idx_cosmetic_theme_items_cosmetic
  ON cosmetic_theme_items(cosmetic_id, theme_id);

INSERT INTO promotion_campaigns (id, is_visible, sort_order, updated_at) VALUES
  ('special-ops', 1, 10, 1785725400000),
  ('summer', 1, 20, 1785725400000),
  ('cyberpunk', 1, 30, 1785725400000)
ON CONFLICT(id) DO NOTHING;

INSERT INTO cosmetic_theme_settings
  (id, label, is_store_visible, sort_order, updated_at) VALUES
  ('special-ops', '특수수사본부 테마', 1, 10, 1785725400000),
  ('summer', '여름 테마', 1, 20, 1785725400000),
  ('cyberpunk', '사이버펑크 테마', 1, 30, 1785725400000)
ON CONFLICT(id) DO NOTHING;

INSERT INTO cosmetic_theme_items (theme_id, cosmetic_id, item_order) VALUES
  ('summer', 'skin-look-puppy-surfer', 10),
  ('summer', 'skin-look-tiger-lifeguard', 20),
  ('summer', 'tile-wave-surfer', 30),
  ('summer', 'tile-beach-lifeguard', 40),
  ('summer', 'turret-basic-surfer-water', 50),
  ('summer', 'turret-basic-lifeguard-parasol', 60),
  ('cyberpunk', 'skin-look-cat-neon-rider', 10),
  ('cyberpunk', 'skin-look-hamster-cyber-driver', 20),
  ('cyberpunk', 'tile-cyberpunk-neon', 30),
  ('cyberpunk', 'turret-basic-cyberpunk-laser', 40),
  ('special-ops', 'skin-look-crocodile-police-enforcer', 10),
  ('special-ops', 'skin-look-monkey-secret-agent', 20),
  ('special-ops', 'tile-special-ops-headquarters', 30),
  ('special-ops', 'turret-basic-special-ops-tracker', 40)
ON CONFLICT(theme_id, cosmetic_id) DO NOTHING;

INSERT OR REPLACE INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.08.03.2',
  '출석·랭크 미션과 이벤트 운영 설정',
  '• 매일 첫 접속 20P와 주 5일 접속 50P 출석 미션을 추가했습니다.' || char(10) ||
  '• 일일 랭크전 1회 및 주간 랭크전 5회 완료 미션을 추가했습니다.' || char(10) ||
  '• 이벤트 팝업의 노출·순서와 여름, 사이버펑크, 특수수사본부 테마의 상점 노출을 DB에서 관리할 수 있습니다.',
  1785725400000
);
