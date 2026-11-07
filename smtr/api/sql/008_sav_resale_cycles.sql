-- A physically verified and released repaired IMEI may enter a subsequent sale.
-- Historical sales are immutable records; a single "active sales" unique index
-- would incorrectly prevent multiple successive ownership cycles of one IMEI.
-- Transactional items.state='AVAILABLE' and FOR UPDATE enforce exclusivity NOW.
ALTER TABLE sales DROP INDEX uq_sales_active_item;
ALTER TABLE sales DROP COLUMN active_item_id;
CREATE INDEX idx_sales_imei_history ON sales(item_id,created_at);
