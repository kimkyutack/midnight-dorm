PRAGMA foreign_keys = ON;

INSERT INTO cosmetic_catalog (
  id, slot, character_id, turret_kind, label, description, symbol, swatch,
  unlock_kind, point_price, unlock_rank, trait_multiplier, asset_directory,
  gameplay_json, display_order, is_active, is_limited, sale_starts_at,
  sale_ends_at, payment_product_id, created_at, updated_at
) VALUES
  (
    'skin-look-cat-neon-rider',
    'skin',
    'character-cat',
    NULL,
    '네온 라이더 루루',
    '네온 고글과 인라인 스케이트로 사이버 시티를 질주하는 프리미엄 스킨',
    '네',
    '#b347ff',
    'points',
    5000,
    NULL,
    2,
    'skin-neon-rider-lulu',
    '{"traitOverride":{"label":"네온 오버클럭","description":"모든 포탑의 공격속도가 2배가 됩니다.","turretRateMultiplier":0.5},"movementEffect":"neon-star-trail"}',
    5,
    1,
    1,
    NULL,
    NULL,
    NULL,
    1785348000000,
    1785348000000
  ),
  (
    'skin-look-hamster-cyber-driver',
    'skin',
    'character-hamster',
    NULL,
    '사이버 드라이버 콩',
    '보랏빛 스포츠카와 무지개 휠로 네온 도로를 달리는 프리미엄 스킨',
    '카',
    '#803cff',
    'points',
    5000,
    NULL,
    2,
    'skin-cyber-driver-kong',
    '{"traitOverride":{"label":"Lv.5 양산 설계","description":"설치하는 모든 공격 포탑이 Lv.5로 시작합니다.","turretStartingLevel":5},"movementEffect":"rainbow-wheel-exhaust"}',
    6,
    1,
    1,
    NULL,
    NULL,
    NULL,
    1785348000000,
    1785348000000
  )
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

INSERT INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.07.29.6',
  '사이버펑크 프리미엄 스킨',
  '• 네온 라이더 루루와 사이버 드라이버 콩 프리미엄 스킨을 추가했습니다.' || char(10) ||
  '• 루루는 포탑 공격속도 2배, 콩은 모든 공격 포탑을 Lv.5로 설치합니다.' || char(10) ||
  '• 여름·사이버펑크 출시 팝업을 독립적으로 넘기고 숨길 수 있습니다.',
  1785348000000
);
