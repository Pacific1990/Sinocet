-- Fourth role: Administrateur technique, separate from Direction.
-- All business permissions for administrator are denied by default AND cannot be
-- assigned via the RBAC management endpoint.
INSERT INTO roles(code,name,description) VALUES
  ('admin','Administrateur','Configuration, utilisateurs, permissions et menus, aucune donnée financière métier par défaut')
ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description);

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(90) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(130) NOT NULL,
  description VARCHAR(255) NOT NULL,
  category VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_permissions_code (code),
  CONSTRAINT ck_permissions_category CHECK(category IN ('system','business'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(role_id,permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id),
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menus (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(110) NOT NULL,
  required_permission VARCHAR(90) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  default_sort SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_menus_code (code),
  CONSTRAINT fk_menus_permission FOREIGN KEY (required_permission) REFERENCES permissions(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_menus (
  role_id BIGINT UNSIGNED NOT NULL,
  menu_id BIGINT UNSIGNED NOT NULL,
  visible TINYINT(1) NOT NULL DEFAULT 1,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  PRIMARY KEY(role_id,menu_id),
  CONSTRAINT fk_role_menus_role FOREIGN KEY (role_id) REFERENCES roles(id),
  CONSTRAINT fk_role_menus_menu FOREIGN KEY (menu_id) REFERENCES menus(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  key_name VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  value_json JSON NOT NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(key_name),
  CONSTRAINT fk_system_settings_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO permissions(code,name,description,category) VALUES
('system.dashboard.view','Accueil administrateur','Consulter les informations de configuration, sans données commerciales','system'),
('system.accounts.manage','Gestion des comptes','Créer, bloquer et réinitialiser les comptes autorisés','system'),
('system.roles.manage','Gestion des permissions','Configurer les permissions des rôles métier','system'),
('system.menus.manage','Gestion des menus','Configurer les menus visibles selon les rôles','system'),
('system.settings.manage','Paramètres techniques','Modifier les paramètres applicatifs non sensibles','system'),
('system.audit.view','Journal de configuration','Lire les opérations de configuration sans détails financiers','system'),
('dashboard.view','Tableau de bord','Consulter les indicateurs autorisés selon son périmètre','business'),
('stocks.view','Consultation des stocks','Consulter les catégories de stock dans son périmètre','business'),
('stocks.manage','Gestion des stocks','Créer des produits, recevoir et rechercher des IMEI au central','business'),
('transfers.view','Consultation des transferts','Consulter ses transferts autorisés','business'),
('transfers.create','Envoi des transferts','Réserver les IMEI et transférer du central à un agent','business'),
('transfers.receive','Réception des transferts','Valider une réception ou signaler un écart','business'),
('sales.view','Consultation des ventes','Consulter les ventes autorisées','business'),
('sales.create','Création des ventes','Vendre depuis son stock attribué','business'),
('customers.view','Lecture des clients','Consulter les clients de son périmètre','business'),
('customers.create','Gestion des clients','Enregistrer des clients autorisés','business'),
('customers.credit.manage','Plafond de crédit client','Modifier les plafonds de crédit client','business'),
('debts.view','Lecture des créances','Consulter les échéances et rappels','business'),
('debts.repay','Encaissement de dettes','Enregistrer un remboursement','business'),
('cash.view','Consultation des caisses','Consulter les encaissements','business'),
('cash.close','Clôture de caisse','Clôturer sa caisse','business'),
('approvals.view','Lecture des validations','Consulter les demandes de validation','business'),
('approvals.request','Demande de validation','Demander une remise, une annulation ou une résolution SAV','business'),
('approvals.decide','Décision Manager','Accepter ou rejeter une demande sensible','business'),
('inventory.view','Consultation des inventaires','Consulter les contrôles de stock','business'),
('inventory.manage','Gestion des inventaires','Geler et contrôler les stocks agents','business'),
('sav.view','Lecture du SAV','Consulter les dossiers de SAV autorisés','business'),
('sav.open','Ouverture SAV','Déclarer un retour pour défaut usine','business'),
('sav.manage','Résolution SAV','Démarrer et résoudre les dossiers SAV','business'),
('reports.view','Exports et rapports','Télécharger les données métier autorisées','business'),
('supervision.view','Supervision des stocks','Consulter la cartographie détaillée des dépôts','business'),
('pricing.view','Consultation des réglages produit','Voir les paramètres de produits hors prix de revient','business'),
('pricing.manage','Tarification','Modifier prix de vente, coûts et seuils','business'),
('audit.view','Journal métier','Consulter le journal d’opérations selon son rôle','business'),
('receipts.view','Reçus','Télécharger les reçus autorisés','business')
ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),category=VALUES(category);

-- One-time defaults. Later changes through the Administrator API remain persistent.
INSERT IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p WHERE
 (r.code='admin' AND p.category='system') OR
 (r.code='director' AND p.category='business') OR
 (r.code='manager' AND p.code IN (
   'dashboard.view','stocks.view','stocks.manage','transfers.view','transfers.create',
   'sales.view','customers.view','customers.create','customers.credit.manage',
   'debts.view','cash.view','approvals.view','approvals.decide','inventory.view',
   'inventory.manage','sav.view','sav.manage','reports.view','supervision.view',
   'pricing.view','audit.view','receipts.view')) OR
 (r.code='agent' AND p.code IN (
   'dashboard.view','stocks.view','transfers.view','transfers.receive',
   'sales.view','sales.create','customers.view','customers.create','debts.view',
   'debts.repay','cash.view','cash.close','approvals.request','sav.view',
   'sav.open','receipts.view'));

INSERT INTO menus(code,name,required_permission,default_sort) VALUES
('dashboard','Accueil','dashboard.view',10),
('stocks','Stocks','stocks.view',20),
('transfers','Transferts','transfers.view',30),
('sales','Ventes','sales.view',40),
('debts','Crédits','debts.view',50),
('cases','SAV','sav.view',60),
('cash','Caisse','cash.view',70),
('inventory','Inventaires','inventory.view',80),
('approvals','Validations','approvals.view',90),
('reports','Rapports','reports.view',100),
('supervision','Supervision','supervision.view',110),
('business_settings','Paramètres produits','pricing.view',120),
('audit','Journal d audit','audit.view',130),
('system','Accueil Administrateur','system.dashboard.view',10),
('users','Utilisateurs','system.accounts.manage',20),
('permissions','Permissions','system.roles.manage',30),
('menus','Menus par rôle','system.menus.manage',40),
('settings','Paramètres système','system.settings.manage',50),
('system_audit','Journal technique','system.audit.view',60)
ON DUPLICATE KEY UPDATE name=VALUES(name),required_permission=VALUES(required_permission),default_sort=VALUES(default_sort);

INSERT IGNORE INTO role_menus(role_id,menu_id,visible,sort_order)
SELECT rp.role_id,m.id,1,m.default_sort FROM role_permissions rp
JOIN permissions p ON p.id=rp.permission_id
JOIN menus m ON m.required_permission=p.code;

INSERT IGNORE INTO system_settings(key_name,value_json) VALUES
('company.name',JSON_QUOTE('Groupe Sinocet Electronics')),
('alerts.transit_days','2'),
('alerts.sav_days','5'),
('ui.page_size','25');
