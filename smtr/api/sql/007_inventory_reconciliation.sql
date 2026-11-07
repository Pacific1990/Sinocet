-- Physical verification required before unfreezing an inventory with discrepancies.
ALTER TABLE inventories ADD COLUMN reconciled_at TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE inventories ADD COLUMN reconciled_by_user_id BIGINT UNSIGNED NULL;
ALTER TABLE inventories ADD CONSTRAINT fk_inventories_reconciled_by FOREIGN KEY (reconciled_by_user_id) REFERENCES users(id);
