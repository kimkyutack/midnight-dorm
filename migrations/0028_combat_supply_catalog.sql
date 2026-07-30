-- Consolidate the old 30-item scouting/discount catalog into twelve
-- combat-focused supplies without losing any paid inventory.
CREATE TEMP TABLE IF NOT EXISTS consumable_replacements (
  source_id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL
);

DELETE FROM consumable_replacements;
INSERT INTO consumable_replacements (source_id, target_id) VALUES
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
  ('blueprint-chip', 'field-crane');

INSERT INTO account_consumables (account_id, item_id, quantity, updated_at)
SELECT inventory.account_id, replacement.target_id, SUM(inventory.quantity), MAX(inventory.updated_at)
FROM account_consumables AS inventory
JOIN consumable_replacements AS replacement ON replacement.source_id = inventory.item_id
GROUP BY inventory.account_id, replacement.target_id
ON CONFLICT(account_id, item_id) DO UPDATE SET
  quantity = quantity + excluded.quantity,
  updated_at = MAX(updated_at, excluded.updated_at);

DELETE FROM account_consumables
WHERE item_id IN (SELECT source_id FROM consumable_replacements);

DROP TABLE consumable_replacements;
