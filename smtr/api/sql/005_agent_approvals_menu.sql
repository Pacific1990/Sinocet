-- Enable own requests in the Agent menu and make legacy grants visible.
INSERT IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p
WHERE r.code='agent' AND p.code='approvals.view';

INSERT IGNORE INTO role_menus(role_id,menu_id,visible,sort_order)
SELECT r.id,m.id,1,90 FROM roles r JOIN menus m
WHERE r.code='agent' AND m.code='approvals';
