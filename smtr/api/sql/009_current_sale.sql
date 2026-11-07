-- Preserve the invoice IMEI while tracking the device currently owed to a customer.
-- A repaired device can be resold; historical sales must never seize its new owner.
ALTER TABLE items ADD COLUMN current_sale_id BIGINT UNSIGNED NULL;
UPDATE items i SET current_sale_id=(SELECT MAX(s.id) FROM sales s WHERE s.item_id=i.id AND s.status='COMPLETED') WHERE i.state IN ('SOLD','SAV','HOLD');
UPDATE items i JOIN sav_cases sc ON sc.item_id=i.id SET i.current_sale_id=NULL WHERE sc.resolution='EXCHANGE' AND sc.status='RESOLVED';
UPDATE items i JOIN sav_cases sc ON sc.replacement_item_id=i.id JOIN sales s ON s.id=sc.sale_id SET i.current_sale_id=s.id WHERE sc.resolution='EXCHANGE' AND sc.status='RESOLVED' AND i.state='SOLD' AND s.status='COMPLETED';
ALTER TABLE items ADD CONSTRAINT fk_items_current_sale FOREIGN KEY (current_sale_id) REFERENCES sales(id);
CREATE UNIQUE INDEX uq_items_current_sale ON items(current_sale_id);
