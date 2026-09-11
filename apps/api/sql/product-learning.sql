-- Run intentionally in ecommerce_dev with psql. DML is rolled back.
-- Connect: psql -h 127.0.0.1 -U ecommerce_app -d ecommerce_dev -W
SELECT * FROM products;
SELECT id, sku, name, price_in_minor_units FROM products ORDER BY created_at DESC, id;
SELECT count(*) FROM products;
SELECT sku, stock FROM products WHERE status = 'ACTIVE' AND stock > 0 ORDER BY sku;
BEGIN;
-- gen_random_uuid exists in PostgreSQL 16. Runtime IDs still come from ProductService.
INSERT INTO products(id, sku, name, description, price_in_minor_units, stock, status, created_at, updated_at)
VALUES (gen_random_uuid(), 'SQL-LEARNING-' || gen_random_uuid()::text, 'Learning product', NULL, 49999, 3, 'ACTIVE', now(), now())
RETURNING id AS learning_id, sku AS learning_sku \gset
SELECT * FROM products WHERE id = :'learning_id';
SELECT * FROM products WHERE sku = :'learning_sku';
UPDATE products SET stock = 5, updated_at = now() WHERE id = :'learning_id' RETURNING *;
EXPLAIN SELECT * FROM products WHERE sku = :'learning_sku';
DELETE FROM products WHERE id = :'learning_id' RETURNING id;
ROLLBACK;

-- Phase 4A: optional Product -> Category association.
SELECT id, slug, name, status FROM categories;
BEGIN;
INSERT INTO categories(id, slug, name, status, created_at, updated_at)
VALUES (gen_random_uuid(), 'JOIN-LEARNING-' || gen_random_uuid()::text, 'Learning category', 'ACTIVE', now(), now())
RETURNING id AS learning_category_id \gset

INSERT INTO products(id, sku, name, price_in_minor_units, stock, status, created_at, updated_at, category_id)
VALUES (gen_random_uuid(), 'JOIN-PRODUCT-' || gen_random_uuid()::text, 'Categorized product', 100, 1, 'ACTIVE', now(), now(), :'learning_category_id')
RETURNING id AS categorized_id \gset
INSERT INTO products(id, sku, name, price_in_minor_units, stock, status, created_at, updated_at)
VALUES (gen_random_uuid(), 'JOIN-NULL-' || gen_random_uuid()::text, 'Uncategorized product', 100, 1, 'ACTIVE', now(), now())
RETURNING id AS uncategorized_id \gset

SELECT id, category_id FROM products WHERE id IN (:'categorized_id', :'uncategorized_id');
-- INNER JOIN: only the product with a matching category.
SELECT p.name AS product, c.name AS category
FROM products p INNER JOIN categories c ON p.category_id = c.id
WHERE p.id IN (:'categorized_id', :'uncategorized_id');
-- LEFT JOIN: both products; the uncategorized product has NULL category columns.
SELECT p.name AS product, c.name AS category
FROM products p LEFT JOIN categories c ON p.category_id = c.id
WHERE p.id IN (:'categorized_id', :'uncategorized_id');
ROLLBACK;
