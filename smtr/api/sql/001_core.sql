-- SMTR initial physical model: no fake business users, items, or warehouses.
-- MySQL 8 / InnoDB. Foreign-key COLUMN nouns remain singular.
CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(255) NOT NULL,
  UNIQUE KEY uq_roles_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (code,name,description) VALUES
('director','Direction','Supervision et audit, authentification à deux facteurs obligatoire'),
('manager','Manager','Stock central, transferts et validations opérationnelles'),
('agent','Agent','Stock attribué et réception des transferts')
ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  name VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  totp_secret_encrypted TEXT NULL,
  last_totp_counter BIGINT NULL,
  failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sessions_token_hash (token_hash),
  INDEX idx_sessions_user (user_id),
  INDEX idx_sessions_expiry (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warehouses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  agent_user_id BIGINT UNSIGNED NULL,
  location VARCHAR(150) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_warehouses_agent_user (agent_user_id),
  CONSTRAINT fk_warehouses_agent_user FOREIGN KEY (agent_user_id) REFERENCES users(id),
  CONSTRAINT ck_warehouses_kind CHECK (kind IN ('CENTRAL','AGENT','SAV')),
  CONSTRAINT ck_warehouses_agent_scope CHECK ((kind='AGENT' AND agent_user_id IS NOT NULL) OR (kind <> 'AGENT' AND agent_user_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  category VARCHAR(120) NOT NULL,
  sku VARCHAR(80) NOT NULL,
  minimum_level INT UNSIGNED NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_products_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  imei VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  location_code VARCHAR(100) NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE',
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_items_imei (imei),
  INDEX idx_items_warehouse_state (warehouse_id,state),
  CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_items_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT ck_items_state CHECK (state IN ('AVAILABLE','IN_TRANSIT','HOLD','SAV'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transfers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_warehouse_id BIGINT UNSIGNED NOT NULL,
  target_warehouse_id BIGINT UNSIGNED NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  received_by_user_id BIGINT UNSIGNED NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'IN_TRANSIT',
  discrepancy_reason VARCHAR(500) NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_at TIMESTAMP NULL DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_transfers_actor_request (created_by_user_id,request_id),
  INDEX idx_transfers_target_status (target_warehouse_id,status),
  CONSTRAINT fk_transfers_source_warehouse FOREIGN KEY (source_warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_transfers_target_warehouse FOREIGN KEY (target_warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_transfers_created_by_user FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_transfers_received_by_user FOREIGN KEY (received_by_user_id) REFERENCES users(id),
  CONSTRAINT ck_transfers_status CHECK (status IN ('IN_TRANSIT','RECEIVED','DISCREPANCY')),
  CONSTRAINT ck_transfers_distinct_warehouses CHECK (source_warehouse_id <> target_warehouse_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transfers_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transfer_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_transfers_items_pair (transfer_id,item_id),
  INDEX idx_transfers_items_item (item_id),
  CONSTRAINT fk_transfers_items_transfer FOREIGN KEY (transfer_id) REFERENCES transfers(id),
  CONSTRAINT fk_transfers_items_item FOREIGN KEY (item_id) REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(100) NOT NULL,
  entity_name VARCHAR(90) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  details_json JSON NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_logs_action_date (action,occurred_at),
  CONSTRAINT fk_logs_actor_user FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
