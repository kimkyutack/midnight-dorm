PRAGMA foreign_keys = ON;

INSERT INTO cosmetic_catalog (
  id, slot, character_id, turret_kind, label, description, symbol, swatch,
  unlock_kind, point_price, unlock_rank, trait_multiplier, asset_directory,
  gameplay_json, display_order, is_active, is_limited, sale_starts_at,
  sale_ends_at, payment_product_id, created_at, updated_at
) VALUES
  (
    'tile-cyberpunk-neon',
    'tile',
    NULL,
    NULL,
    '네온 회로 타일',
    '침대를 점유하면 네온 빌딩이 솟아올랐다 무너지며 회로 타일이 펼쳐집니다.',
    '전',
    '#b347ff',
    'points',
    1000,
    NULL,
    1,
    'skin-cyberpunk-neon/neon-circuit-tile.webp',
    '{"transition":"neon-building-collapse"}',
    10,
    1,
    1,
    NULL,
    NULL,
    NULL,
    1785351600000,
    1785351600000
  ),
  (
    'turret-basic-cyberpunk-laser',
    'turret',
    NULL,
    'basic-turret',
    '네온 레이저포',
    '권총부터 거대 레이저포까지 15단계 외형과 굵은 네온 레이저를 적용합니다.',
    '광',
    '#f24dff',
    'points',
    1500,
    NULL,
    1,
    'skin-cyberpunk-laser',
    '{"levels":15,"progression":"pistol-to-laser-fortress","projectileEffect":"pooled-thick-neon-laser"}',
    5,
    1,
    1,
    NULL,
    NULL,
    NULL,
    1785351600000,
    1785351600000
  )
ON CONFLICT(id) DO UPDATE SET
  slot = excluded.slot,
  character_id = excluded.character_id,
  turret_kind = excluded.turret_kind,
  label = excluded.label,
  description = excluded.description,
  symbol = excluded.symbol,
  swatch = excluded.swatch,
  unlock_kind = excluded.unlock_kind,
  point_price = excluded.point_price,
  unlock_rank = excluded.unlock_rank,
  trait_multiplier = excluded.trait_multiplier,
  asset_directory = excluded.asset_directory,
  gameplay_json = excluded.gameplay_json,
  display_order = excluded.display_order,
  is_active = excluded.is_active,
  is_limited = excluded.is_limited,
  updated_at = excluded.updated_at;

INSERT INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.07.29.7',
  '사이버펑크 테마 확장',
  '• 보랏빛 회로와 네온 빌딩 전환 연출을 가진 네온 회로 타일을 추가했습니다.' || char(10) ||
  '• 권총부터 거대 레이저포까지 15단계로 성장하는 네온 레이저포를 추가했습니다.' || char(10) ||
  '• 네온 레이저포 공격에 성능 제한형 굵은 레이저 이펙트를 적용했습니다.',
  1785351600000
);
