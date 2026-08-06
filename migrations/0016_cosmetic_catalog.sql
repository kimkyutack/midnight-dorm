PRAGMA foreign_keys = ON;

-- Images remain immutable static assets. D1 owns the commercial catalog and
-- release metadata so prices, availability, ordering, and limited-sale windows
-- can change without rewriting account ownership rows.
CREATE TABLE IF NOT EXISTS cosmetic_catalog (
  id TEXT PRIMARY KEY,
  slot TEXT NOT NULL CHECK (slot IN ('character', 'skin', 'turret')),
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

CREATE INDEX IF NOT EXISTS idx_cosmetic_catalog_listing
  ON cosmetic_catalog(slot, is_active, display_order, id);
CREATE INDEX IF NOT EXISTS idx_cosmetic_catalog_character
  ON cosmetic_catalog(character_id, slot, is_active);

INSERT INTO cosmetic_catalog (
  id, slot, character_id, label, description, symbol, swatch,
  unlock_kind, point_price, unlock_rank, trait_multiplier, asset_directory,
  gameplay_json, display_order, is_active, is_limited, created_at, updated_at
) VALUES
  ('character-bunny', 'character', NULL, '밤토끼 모모', '작지만 겁이 없는 기본 생존자', '토', '#e9c7bc', 'starter', NULL, NULL, 1, NULL, '{"trait":"none"}', 10, 1, 0, 1785225600000, 1785225600000),
  ('character-cat', 'character', NULL, '달고양이 루루', '초승달 귀를 가진 재빠른 고양이', '냥', '#bdc5da', 'points', 500, NULL, 1, NULL, '{"trait":"turret-speed"}', 20, 1, 0, 1785225600000, 1785225600000),
  ('character-puppy', 'character', NULL, '구름강아지 몽', '축 처진 귀와 동그란 코가 매력적', '멍', '#d8aa78', 'points', 650, NULL, 1, NULL, '{"trait":"gold-income"}', 30, 1, 0, 1785225600000, 1785225600000),
  ('character-bear', 'character', NULL, '도토리곰 밤이', '고수 등급이 인정한 든든한 생존자', '곰', '#9b6f52', 'rank', NULL, 'expert', 1, NULL, '{"trait":"turret-damage"}', 40, 1, 0, 1785225600000, 1785225600000),
  ('character-fox', 'character', NULL, '별여우 초롱', '초고수만 만날 수 있는 별빛 여우', '여', '#d9784d', 'rank', NULL, 'master', 1, NULL, '{"trait":"extra-draw"}', 50, 1, 0, 1785225600000, 1785225600000),
  ('character-hamster', 'character', NULL, '유령햄스터 콩', '볼이 빵빵한 야간 정찰대원', '햄', '#d6b583', 'points', 900, NULL, 1, NULL, '{"trait":"starter-turret"}', 60, 1, 0, 1785225600000, 1785225600000),
  ('character-crocodile', 'character', NULL, '늪악어 크로크', '늪지의 턱힘으로 포탑 피해를 크게 높인다', '악', '#5d9b61', 'points', 1500, NULL, 1, NULL, '{"trait":"croc-bite"}', 70, 1, 0, 1785225600000, 1785225600000),
  ('character-duck', 'character', NULL, '달오리 꽥', '달빛 동전을 물어오는 부유한 정찰대원', '오', '#f0cb4e', 'points', 1350, NULL, 1, NULL, '{"trait":"duck-treasure"}', 80, 1, 0, 1785225600000, 1785225600000),
  ('character-tiger', 'character', NULL, '달호랑이 라온', '호랑이의 시야로 수호 포탑의 사거리를 넓힌다', '호', '#e29a4d', 'points', 1800, NULL, 1, NULL, '{"trait":"tiger-range"}', 90, 1, 0, 1785225600000, 1785225600000),
  ('character-dinosaur', 'character', NULL, '별공룡 라그', '포탑의 과충전 발사를 지휘하는 작은 공룡', '공', '#73b85d', 'points', 2000, NULL, 1, NULL, '{"trait":"dino-overdrive"}', 100, 1, 0, 1785225600000, 1785225600000),
  ('character-monkey', 'character', NULL, '달원숭이 몽키', '행운의 손재주로 랜덤상자를 두 번 더 돌린다', '원', '#8d5c42', 'points', 2400, NULL, 1, NULL, '{"trait":"monkey-luck"}', 110, 1, 0, 1785225600000, 1785225600000),
  ('character-gorilla', 'character', NULL, '요새고릴라 콩', '든든한 힘으로 점유한 방의 문을 강화한다', '고', '#53606d', 'points', 2600, NULL, 1, NULL, '{"trait":"fortress-door"}', 120, 1, 0, 1785225600000, 1785225600000)
ON CONFLICT(id) DO UPDATE SET
  label = excluded.label,
  description = excluded.description,
  symbol = excluded.symbol,
  swatch = excluded.swatch,
  unlock_kind = excluded.unlock_kind,
  point_price = excluded.point_price,
  unlock_rank = excluded.unlock_rank,
  gameplay_json = excluded.gameplay_json,
  display_order = excluded.display_order,
  is_active = excluded.is_active,
  updated_at = excluded.updated_at;

INSERT INTO cosmetic_catalog (
  id, slot, character_id, label, description, symbol, swatch,
  unlock_kind, point_price, trait_multiplier, asset_directory, gameplay_json,
  display_order, is_active, is_limited, created_at, updated_at
) VALUES
  ('skin-look-puppy-surfer', 'skin', 'character-puppy', '서퍼 몽', '하늘빛 고글과 보드를 타고 물결 위를 미끄러지는 완성형 스킨', '파', '#72d9f4', 'points', 5000, 2, 'skin-surfer-mong', '{}', 10, 1, 1, 1785218400000, 1785225600000),
  ('skin-look-tiger-lifeguard', 'skin', 'character-tiger', '해변 구조대 라온', '구명 튜브와 호루라기를 갖추고 물보라를 가르며 달리는 여름 한정 스킨', '구', '#ef5548', 'points', 5000, 2, 'skin-lifeguard-raon', '{}', 20, 1, 1, 1785225600000, 1785225600000),
  ('skin-look-bunny-ward', 'skin', 'character-bunny', '탐험가 모모', '노란 안전모와 파란 후드의 완성형 이벤트 스킨', '토', '#e9c7bc', 'points', 100, 1.5, NULL, '{"traitOverride":{"unclaimedMoveSpeedMultiplier":1.5}}', 30, 1, 0, 1785225600000, 1785225600000),
  ('skin-look-cat-ward', 'skin', 'character-cat', '새벽 탐정 루루', '빨간 재킷과 배낭을 갖춘 완성형 스킨', '냥', '#bdc5da', 'points', 2500, 1.5, NULL, '{}', 40, 1, 0, 1785225600000, 1785225600000),
  ('skin-look-puppy-ward', 'skin', 'character-puppy', '구조대 몽', '구조 조끼를 입은 완성형 스킨', '멍', '#d8aa78', 'points', 2500, 1.5, NULL, '{}', 50, 1, 0, 1785225600000, 1785225600000),
  ('skin-look-bear-ward', 'skin', 'character-bear', '야간 경비 밤이', '경비복을 입은 완성형 스킨', '곰', '#9b6f52', 'points', 2500, 1.5, NULL, '{}', 60, 1, 0, 1785225600000, 1785225600000),
  ('skin-look-fox-ward', 'skin', 'character-fox', '별빛 여우 초롱', '별 문양 코트를 입은 완성형 스킨', '여', '#d9784d', 'points', 2500, 1.5, NULL, '{}', 70, 1, 0, 1785225600000, 1785225600000),
  ('skin-look-hamster-ward', 'skin', 'character-hamster', '개구리 탐험가 콩', '탐험복을 입은 완성형 스킨', '햄', '#d6b583', 'points', 2500, 1.5, NULL, '{}', 80, 1, 0, 1785225600000, 1785225600000),
  ('skin-look-crocodile-ward', 'skin', 'character-crocodile', '늪지 경비 크로크', '보호 장비를 갖춘 완성형 스킨', '악', '#5d9b61', 'points', 2500, 1.5, NULL, '{}', 90, 1, 0, 1785225600000, 1785225600000),
  ('skin-look-duck-ward', 'skin', 'character-duck', '달빛 정찰 꽥', '정찰 헬멧을 쓴 완성형 스킨', '오', '#f0cb4e', 'points', 2500, 1.5, NULL, '{}', 100, 1, 0, 1785225600000, 1785225600000),
  ('skin-look-tiger-ward', 'skin', 'character-tiger', '붉은 번개 라온', '붉은 전투복의 완성형 스킨', '호', '#e29a4d', 'points', 2500, 1.5, NULL, '{}', 110, 1, 0, 1785225600000, 1785225600000),
  ('skin-look-dinosaur-ward', 'skin', 'character-dinosaur', '과충전 라그', '기계 장비를 갖춘 완성형 스킨', '공', '#73b85d', 'points', 2500, 1.5, NULL, '{}', 120, 1, 0, 1785225600000, 1785225600000),
  ('skin-look-monkey-ward', 'skin', 'character-monkey', '야간 정비 몽키', '정비복을 입은 완성형 스킨', '원', '#8d5c42', 'points', 2500, 1.5, NULL, '{}', 130, 1, 0, 1785225600000, 1785225600000),
  ('skin-look-gorilla-ward', 'skin', 'character-gorilla', '요새 수호 콩', '중장비 수호복의 완성형 스킨', '고', '#53606d', 'points', 2500, 1.5, NULL, '{}', 140, 1, 0, 1785225600000, 1785225600000)
ON CONFLICT(id) DO UPDATE SET
  character_id = excluded.character_id,
  label = excluded.label,
  description = excluded.description,
  symbol = excluded.symbol,
  swatch = excluded.swatch,
  unlock_kind = excluded.unlock_kind,
  point_price = excluded.point_price,
  trait_multiplier = excluded.trait_multiplier,
  asset_directory = excluded.asset_directory,
  gameplay_json = excluded.gameplay_json,
  display_order = excluded.display_order,
  is_active = excluded.is_active,
  is_limited = excluded.is_limited,
  updated_at = excluded.updated_at;

INSERT OR IGNORE INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.07.28.4',
  '여름 한정 스킨: 해변 구조대 라온',
  '• 빨간 구조대 모자와 구명 튜브를 갖춘 해변 구조대 라온을 추가했습니다.' || char(10) ||
  '• 라온의 수호 포탑 사거리 특성을 200% 효율로 적용하며 5,000P에 구매할 수 있습니다.' || char(10) ||
  '• 서퍼 몽과 구조대 라온이 함께 등장하는 여름 특별 스킨 통합 이벤트를 적용했습니다.' || char(10) ||
  '• 캐릭터와 스킨 상품 정보를 관리할 D1 카탈로그를 추가했습니다.',
  1785225600000
);
