-- SNG Logistics migration 014: canonical workflow, rider identity and durable notifications

CREATE TABLE IF NOT EXISTS customer_notification_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_key VARCHAR(120) NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  channel ENUM('WHATSAPP') NOT NULL DEFAULT 'WHATSAPP',
  event_type VARCHAR(80) NOT NULL,
  status ENUM('PENDING','SENDING','SENT','FAILED','SKIPPED') NOT NULL DEFAULT 'PENDING',
  recipient VARCHAR(40) NULL,
  payload JSON NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 8,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT NULL,
  sent_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notification_event (event_key),
  KEY idx_notification_pending (status, next_attempt_at),
  KEY idx_notification_order (order_id),
  CONSTRAINT fk_notification_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @c = (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema=DATABASE() AND table_name='riders' AND column_name='user_id');
SET @s = IF(@c=0,
  'ALTER TABLE riders ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

UPDATE riders r
JOIN users u ON u.role='rider' AND BINARY u.phone=BINARY r.phone
SET r.user_id=u.id
WHERE r.user_id IS NULL;

SET @idx = (SELECT COUNT(*) FROM information_schema.statistics
            WHERE table_schema=DATABASE() AND table_name='riders' AND index_name='uq_riders_user');
SET @s = IF(@idx=0,
  'ALTER TABLE riders ADD UNIQUE KEY uq_riders_user (user_id)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @fk = (SELECT COUNT(*) FROM information_schema.table_constraints
           WHERE constraint_schema=DATABASE() AND table_name='riders'
             AND constraint_name='fk_riders_user');
SET @s = IF(@fk=0,
  'ALTER TABLE riders ADD CONSTRAINT fk_riders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

ALTER TABLE orders MODIFY COLUMN rider_id BIGINT UNSIGNED NULL;

UPDATE orders o
JOIN riders r ON o.rider_id=r.id AND r.user_id IS NOT NULL
SET o.rider_id=r.user_id;

UPDATE orders o
LEFT JOIN users u ON u.id=o.rider_id AND u.role='rider'
SET o.rider_id=NULL
WHERE o.rider_id IS NOT NULL AND u.id IS NULL;

SET @fk = (SELECT COUNT(*) FROM information_schema.table_constraints
           WHERE constraint_schema=DATABASE() AND table_name='orders'
             AND constraint_name='fk_orders_rider_user');
SET @s = IF(@fk=0,
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_rider_user FOREIGN KEY (rider_id) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

UPDATE orders SET status='ON_TRUCK' WHERE status='ON_TRUCK_BORDER';
UPDATE orders SET status='CUSTOMS_HOLD' WHERE status='PENDING_CUSTOMS';
UPDATE orders SET status='CUSTOMS_REJECTED' WHERE status='SCREENING_FAILED';
UPDATE orders SET status=IF(direction='LA_TO_TH','RECEIVED_WH_LA','RECEIVED_WH_TH')
  WHERE status='READY_TO_LOAD';
UPDATE orders SET status='RIDER_ASSIGNED' WHERE status='ASSIGNED_TO_RIDER';
UPDATE orders SET status='RIDER_ACCEPTED' WHERE status='ACCEPTED_BY_RIDER';
UPDATE orders SET status='OUT_FOR_DELIVERY' WHERE status='PICKED_UP_BY_RIDER';

UPDATE users SET role='warehouse_th' WHERE role='thai_warehouse';
UPDATE users SET role='warehouse_la' WHERE role='lao_warehouse';
