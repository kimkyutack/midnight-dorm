PRAGMA foreign_keys = ON;

INSERT INTO cosmetic_catalog (
  id, slot, character_id, turret_kind, label, description, symbol, swatch,
  unlock_kind, point_price, unlock_rank, trait_multiplier, asset_directory,
  gameplay_json, display_order, is_active, is_limited, sale_starts_at,
  sale_ends_at, payment_product_id, created_at, updated_at
) VALUES
  (
    'tile-special-ops-headquarters',
    'tile',
    NULL,
    NULL,
    '특수수사본부 타일',
    '방 바닥을 청회색 수사본부 타일로 바꿉니다.',
    '수',
    '#4f79a8',
    'points',
    1000,
    NULL,
    1,
    'skin-special-ops-headquarters/investigation-floor.webp',
    '{"transition":"investigation-scan"}',
    11,
    1,
    1,
    NULL,
    NULL,
    NULL,
    1785499200000,
    1785499200000
  ),
  (
    'turret-basic-special-ops-tracker',
    'turret',
    NULL,
    'basic-turret',
    '기밀 추적포',
    '감시 장치부터 스마트 레일건까지 성장합니다.',
    '추',
    '#d5dce8',
    'points',
    1500,
    NULL,
    1,
    'skin-special-ops-tracker',
    '{"levels":15,"progression":"evidence-case-to-smart-railgun","projectileEffect":"pooled-white-tracer-blue-impact"}',
    6,
    1,
    1,
    NULL,
    NULL,
    NULL,
    1785499200000,
    1785499200000
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

INSERT OR REPLACE INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.07.31.5',
  '특수수사본부 테마',
  '• 청회색 수사본부 바닥과 수사 스캔 전환 연출을 가진 특수수사본부 타일을 추가했습니다.' || char(10) ||
  '• 서류가방형 감시 장치에서 스마트 레일건까지 15단계로 성장하는 기밀 추적포를 추가했습니다.' || char(10) ||
  '• 기밀 추적포에 성능 제한형 청백색 추적탄과 착탄 효과를 적용했습니다.',
  1785499200000
);
