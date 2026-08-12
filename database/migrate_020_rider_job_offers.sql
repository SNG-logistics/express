-- SNG Logistics migration 020: rider job offers (broadcast & claim).
-- A delivery job is broadcast to every active rider in the destination branch;
-- the first rider to claim (in-app or via WhatsApp reply) wins. Idempotent.

CREATE TABLE IF NOT EXISTS delivery_offers (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id    BIGINT UNSIGNED NOT NULL,
  branch_id   BIGINT UNSIGNED NULL,
  status      ENUM('OPEN','CLAIMED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'OPEN',
  claim_code  VARCHAR(8) NOT NULL,              -- short code riders type in WhatsApp (e.g. "A3F")
  claimed_by  BIGINT UNSIGNED NULL,             -- users.id of the winning rider
  claimed_at  DATETIME NULL,
  expires_at  DATETIME NULL,
  created_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_offer_order  (order_id),
  KEY idx_offer_status (status),
  KEY idx_offer_code   (claim_code),
  CONSTRAINT fk_offer_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS delivery_offer_recipients (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  offer_id      BIGINT UNSIGNED NOT NULL,
  rider_user_id BIGINT UNSIGNED NOT NULL,       -- users.id (role='rider')
  phone         VARCHAR(40) NULL,
  channel       ENUM('SYSTEM','WHATSAPP') NOT NULL DEFAULT 'SYSTEM',
  notified_at   DATETIME NULL,
  responded_at  DATETIME NULL,
  response      ENUM('CLAIMED','MISSED','DECLINED') NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_offer_rider (offer_id, rider_user_id),
  KEY idx_recipient_rider (rider_user_id),
  CONSTRAINT fk_recipient_offer FOREIGN KEY (offer_id) REFERENCES delivery_offers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
