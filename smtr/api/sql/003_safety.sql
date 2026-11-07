-- Additional consistency for the first complete SMTR release.
ALTER TABLE users ADD COLUMN approval_pin_hash VARCHAR(255) NULL;
ALTER TABLE sales ADD COLUMN request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE sav_cases ADD COLUMN replacement_item_id BIGINT UNSIGNED NULL;
ALTER TABLE sav_cases ADD CONSTRAINT fk_sav_cases_replacement_item FOREIGN KEY (replacement_item_id) REFERENCES items(id);
ALTER TABLE sales ADD CONSTRAINT fk_sales_approval FOREIGN KEY (approval_id) REFERENCES approvals(id);
ALTER TABLE payments DROP CHECK ck_payments_kind;
ALTER TABLE payments ADD CONSTRAINT ck_payments_kind CHECK (kind IN ('SALE','REPAYMENT','REFUND'));
CREATE INDEX idx_sales_item_status ON sales(item_id,status);
CREATE INDEX idx_debts_customer_status ON debts(customer_id,status);
CREATE TRIGGER smtr_logs_immutable_update BEFORE UPDATE ON logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Audit log is immutable';
CREATE TRIGGER smtr_logs_immutable_delete BEFORE DELETE ON logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Audit log is immutable';
