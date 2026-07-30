-- Consolidate the old 30-item scouting/discount catalog into twelve
-- combat-focused supplies without losing any paid inventory. D1 remote
-- migrations reject CREATE TEMP TABLE with SQLITE_AUTH, so keep the mapping
-- inside a statement-local CTE.
WITH consumable_replacements(source_id, target_id) AS (
  VALUES
    ('quiet-slippers', 'scout-flare'),
    ('echo-lens', 'scout-flare'),
    ('moon-compass', 'path-chalk'),
    ('sprint-candy', 'adrenal-shot'),
    ('mist-cape', 'path-chalk'),
    ('rescue-whistle', 'room-beacon'),
    ('repair-window', 'quick-mortar'),
    ('emergency-bedroll', 'quick-mortar'),
    ('patch-paste', 'quick-mortar'),
    ('steel-rivet', 'hinge-brace'),
    ('ice-seal', 'ward-seal'),
    ('rewind-clock', 'quick-mortar'),
    ('calibrator-key', 'toolbelt-voucher'),
    ('pulse-solder', 'turret-grease'),
    ('spare-gears', 'turret-grease'),
    ('copper-coil', 'turret-grease'),
    ('welding-gel', 'lens-kit'),
    ('blueprint-chip', 'field-crane')
)
INSERT INTO account_consumables (account_id, item_id, quantity, updated_at)
SELECT inventory.account_id, replacement.target_id, SUM(inventory.quantity), MAX(inventory.updated_at)
FROM account_consumables AS inventory
JOIN consumable_replacements AS replacement ON replacement.source_id = inventory.item_id
GROUP BY inventory.account_id, replacement.target_id
ON CONFLICT(account_id, item_id) DO UPDATE SET
  quantity = quantity + excluded.quantity,
  updated_at = MAX(updated_at, excluded.updated_at);

DELETE FROM account_consumables
WHERE item_id IN (
  'quiet-slippers',
  'echo-lens',
  'moon-compass',
  'sprint-candy',
  'mist-cape',
  'rescue-whistle',
  'repair-window',
  'emergency-bedroll',
  'patch-paste',
  'steel-rivet',
  'ice-seal',
  'rewind-clock',
  'calibrator-key',
  'pulse-solder',
  'spare-gears',
  'copper-coil',
  'welding-gel',
  'blueprint-chip'
);
