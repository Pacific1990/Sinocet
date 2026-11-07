-- SMTR v2: operations specified in catalogue CDC-SINOCET-2026-001 v3.1
-- Apply only once via scripts/migrate.mjs. MySQL 8.0 / InnoDB.
ALTER TABLE users
  ADD COLUMN credit_limit_f BIGINT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE products
  ADD COLUMN sale_price_f BIGINT UNSIGNED NULL,
  ADD COLUMN purchase_cost_f BIGINT UNSIGNED NULL;
ALTER TABLE warehouses
  ADD COLUMN frozen TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE items
  ADD COLUMN sold_at DATETIME NULL;
ALTER TABLE logs
  ADD COLUMN source_ip VARCHAR(45) NULL;


-- Sold stock is never available for new sales.
ALTER TABLE items DROP CHECK ck_items_state;
ALTER TABLE items ADD CONSTRAINT ck_items_state CHECK (state IN ('AVAILABLE','IN_TRANSIT','HOLD','SAV','SOLD'));

CREATE TABLE IF NOT EXISTS customers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(35) NULL,
  agent_user_id BIGINT UNSIGNED NOT NULL,
  credit_limit_f BIGINT UNSIGNED NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customers_agent (agent_user_id),
  CONSTRAINT fk_customers_agent FOREIGN KEY (agent_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_user_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  gross_amount_f BIGINT UNSIGNED NOT NULL,
  discount_amount_f BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_amount_f BIGINT UNSIGNED NOT NULL,
  paid_amount_f BIGINT UNSIGNED NOT NULL,
  credit_amount_f BIGINT UNSIGNED NOT NULL,
  cost_amount_f BIGINT UNSIGNED NULL,
  payment_method VARCHAR(20) NOT NULL,
  payment_reference VARCHAR(120) NULL,
  approval_id BIGINT UNSIGNED NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP NULL,
  cancelled_by_user_id BIGINT UNSIGNED NULL,
  cancel_reason VARCHAR(500) NULL,
  UNIQUE KEY uq_sales_actor_request (agent_user_id,request_id),
  active_item_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status='COMPLETED' THEN item_id ELSE NULL END) STORED,
  UNIQUE KEY uq_sales_active_item (active_item_id),
  INDEX idx_sales_created (created_at),
  INDEX idx_sales_agent_date (agent_user_id,created_at),
  CONSTRAINT fk_sales_agent FOREIGN KEY (agent_user_id) REFERENCES users(id),
  CONSTRAINT fk_sales_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_sales_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_sales_cancelled_by FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id),
  CONSTRAINT ck_sales_payment_method CHECK (payment_method IN ('CASH','MOBILE_MONEY','TRANSFER','CREDIT')),
  CONSTRAINT ck_sales_status CHECK (status IN ('COMPLETED','CANCELLED')),
  CONSTRAINT ck_sales_amounts CHECK (paid_amount_f+credit_amount_f=total_amount_f AND discount_amount_f<=gross_amount_f)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS debts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sale_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  agent_user_id BIGINT UNSIGNED NOT NULL,
  original_amount_f BIGINT UNSIGNED NOT NULL,
  remaining_amount_f BIGINT UNSIGNED NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_debts_sale (sale_id),
  INDEX idx_debts_agent_due (agent_user_id,due_date,status),
  CONSTRAINT fk_debts_sale FOREIGN KEY (sale_id) REFERENCES sales(id),
  CONSTRAINT fk_debts_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_debts_agent FOREIGN KEY (agent_user_id) REFERENCES users(id),
  CONSTRAINT ck_debts_status CHECK (status IN ('OPEN','PAID','CANCELLED')),
  CONSTRAINT ck_debts_amount CHECK (remaining_amount_f<=original_amount_f)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sale_id BIGINT UNSIGNED NULL,
  debt_id BIGINT UNSIGNED NULL,
  agent_user_id BIGINT UNSIGNED NOT NULL,
  amount_f BIGINT UNSIGNED NOT NULL,
  method VARCHAR(20) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  reference VARCHAR(120) NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payments_agent_request (agent_user_id,request_id),
  INDEX idx_payments_agent_date (agent_user_id,created_at),
  CONSTRAINT fk_payments_sale FOREIGN KEY (sale_id) REFERENCES sales(id),
  CONSTRAINT fk_payments_debt FOREIGN KEY (debt_id) REFERENCES debts(id),
  CONSTRAINT fk_payments_agent FOREIGN KEY (agent_user_id) REFERENCES users(id),
  CONSTRAINT ck_payments_method CHECK (method IN ('CASH','MOBILE_MONEY','TRANSFER')),
  CONSTRAINT ck_payments_kind CHECK (kind IN ('SALE','REPAYMENT'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS approvals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  kind VARCHAR(35) NOT NULL,
  sale_id BIGINT UNSIGNED NULL,
  item_id BIGINT UNSIGNED NULL,
  sav_case_id BIGINT UNSIGNED NULL,
  discount_percent TINYINT UNSIGNED NULL,
  resolution VARCHAR(25) NULL,
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  applied_at TIMESTAMP NULL,
  CONSTRAINT fk_approvals_requested FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_approvals_reviewed FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_approvals_sale FOREIGN KEY (sale_id) REFERENCES sales(id),
  CONSTRAINT fk_approvals_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT ck_approvals_kind CHECK (kind IN ('CANCEL_SALE','DISCOUNT','SAV_RESOLUTION')),
  CONSTRAINT ck_approvals_status CHECK (status IN ('PENDING','APPROVED','REJECTED','APPLIED')),
  INDEX idx_approvals_pending (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sav_cases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sale_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  agent_user_id BIGINT UNSIGNED NOT NULL,
  defect VARCHAR(600) NOT NULL,
  resolution VARCHAR(25) NULL,
  status VARCHAR(25) NOT NULL DEFAULT 'OPEN',
  origin_warehouse_id BIGINT UNSIGNED NOT NULL,
  sav_warehouse_id BIGINT UNSIGNED NOT NULL,
  manager_user_id BIGINT UNSIGNED NULL,
  returned_to_stock_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  INDEX idx_sav_case_item (item_id),
  INDEX idx_sav_status_date (status,created_at),
  CONSTRAINT fk_sav_cases_sale FOREIGN KEY (sale_id) REFERENCES sales(id),
  CONSTRAINT fk_sav_cases_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_sav_cases_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_sav_cases_agent FOREIGN KEY (agent_user_id) REFERENCES users(id),
  CONSTRAINT fk_sav_cases_origin FOREIGN KEY (origin_warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_sav_cases_warehouse FOREIGN KEY (sav_warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_sav_cases_manager FOREIGN KEY (manager_user_id) REFERENCES users(id),
  CONSTRAINT ck_sav_status CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','RELEASED')),
  CONSTRAINT ck_sav_resolution CHECK (resolution IS NULL OR resolution IN ('REPAIR','EXCHANGE','REFUND'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE approvals
  ADD CONSTRAINT fk_approvals_sav_case FOREIGN KEY (sav_case_id) REFERENCES sav_cases(id);

CREATE TABLE IF NOT EXISTS inventories (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  started_by_user_id BIGINT UNSIGNED NOT NULL,
  finished_by_user_id BIGINT UNSIGNED NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  note VARCHAR(500) NULL,
  INDEX idx_inventories_warehouse_status (warehouse_id,status),
  CONSTRAINT fk_inventories_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_inventories_started_by FOREIGN KEY (started_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_inventories_finished_by FOREIGN KEY (finished_by_user_id) REFERENCES users(id),
  CONSTRAINT ck_inventories_status CHECK (status IN ('IN_PROGRESS','CLOSED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventories_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inventory_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  expected_count INT UNSIGNED NOT NULL,
  counted_count INT UNSIGNED NULL,
  UNIQUE KEY uq_inventories_product (inventory_id,product_id),
  CONSTRAINT fk_inventories_lines_inventory FOREIGN KEY (inventory_id) REFERENCES inventories(id),
  CONSTRAINT fk_inventories_lines_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_closures (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_user_id BIGINT UNSIGNED NOT NULL,
  business_day DATE NOT NULL,
  expected_cash_f BIGINT UNSIGNED NOT NULL,
  expected_mobile_f BIGINT UNSIGNED NOT NULL,
  expected_transfer_f BIGINT UNSIGNED NOT NULL,
  declared_cash_f BIGINT UNSIGNED NOT NULL,
  declared_mobile_f BIGINT UNSIGNED NOT NULL,
  declared_transfer_f BIGINT UNSIGNED NOT NULL,
  closed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cash_closures_agent_day (agent_user_id,business_day),
  CONSTRAINT fk_cash_closures_agent FOREIGN KEY (agent_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS movements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(35) NOT NULL,
  origin_warehouse_id BIGINT UNSIGNED NULL,
  destination_warehouse_id BIGINT UNSIGNED NULL,
  reference_type VARCHAR(40) NOT NULL,
  reference_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_movements_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_movements_actor FOREIGN KEY (actor_user_id) REFERENCES users(id),
  CONSTRAINT fk_movements_origin FOREIGN KEY (origin_warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_movements_destination FOREIGN KEY (destination_warehouse_id) REFERENCES warehouses(id),
  INDEX idx_movements_item_date (item_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS realtime_tickets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  ticket_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  UNIQUE KEY uq_realtime_tickets_hash (ticket_hash),
  CONSTRAINT fk_realtime_tickets_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
