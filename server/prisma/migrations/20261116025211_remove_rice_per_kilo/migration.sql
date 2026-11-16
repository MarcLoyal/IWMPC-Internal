-- Dinorado and Sinandomeng are no longer sold per kilo.
-- A "per kilo" unit that was never sold is removed. One that was already sold is kept (so past
-- sales and reports stay correct) but is no longer sold, and is hidden on the prices page.
UPDATE "product_units" u SET "active" = false
WHERE u."label" = 'per kilo'
  AND u."product_id" IN (SELECT "id" FROM "products" WHERE "name" IN ('Dinorado', 'Sinandomeng'))
  AND EXISTS (SELECT 1 FROM "sale_items" i WHERE i."product_unit_id" = u."id");

DELETE FROM "price_changes" c
USING "product_units" u
WHERE c."product_unit_id" = u."id"
  AND u."label" = 'per kilo'
  AND u."product_id" IN (SELECT "id" FROM "products" WHERE "name" IN ('Dinorado', 'Sinandomeng'))
  AND NOT EXISTS (SELECT 1 FROM "sale_items" i WHERE i."product_unit_id" = u."id");

DELETE FROM "product_units" u
WHERE u."label" = 'per kilo'
  AND u."product_id" IN (SELECT "id" FROM "products" WHERE "name" IN ('Dinorado', 'Sinandomeng'))
  AND NOT EXISTS (SELECT 1 FROM "sale_items" i WHERE i."product_unit_id" = u."id");
