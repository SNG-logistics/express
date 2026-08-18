-- ═══════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 011: Rider Mode (SAFE - skip existing)
-- ═══════════════════════════════════════════════════════════════

-- ── เพิ่มเฉพาะ column ที่ยังไม่มี ─────────────────────────────────

-- rider tracking
ALTER TABLE orders ADD COLUMN rider_id             INT           NULL;
ALTER TABLE orders ADD COLUMN assigned_at          DATETIME      NULL;
ALTER TABLE orders ADD COLUMN accepted_at          DATETIME      NULL;
ALTER TABLE orders ADD COLUMN picked_up_at         DATETIME      NULL;
ALTER TABLE orders ADD COLUMN out_for_delivery_at  DATETIME      NULL;
ALTER TABLE orders ADD COLUMN delivery_failed_at   DATETIME      NULL;
ALTER TABLE orders ADD COLUMN pod_signature_url    VARCHAR(500)  NULL;
ALTER TABLE orders ADD COLUMN delivery_lat         DECIMAL(10,8) NULL;
ALTER TABLE orders ADD COLUMN delivery_lng         DECIMAL(11,8) NULL;
ALTER TABLE orders ADD COLUMN delivery_accuracy    FLOAT         NULL;
ALTER TABLE orders ADD COLUMN delivery_distance_m  INT           NULL COMMENT 'ระยะห่างจากที่อยู่ลูกค้า (เมตร)';
ALTER TABLE orders ADD COLUMN gps_verified         TINYINT(1)    DEFAULT 0;
ALTER TABLE orders ADD COLUMN cod_collected_amount DECIMAL(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN fail_note            TEXT          NULL;

-- ── delivery_events ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_events (
  id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id    INT          NOT NULL,
  rider_id    INT          NOT NULL,
  event_type  ENUM(
                'ASSIGNED','ACCEPTED','PICKED_UP','DEPARTED',
                'ARRIVED_CUSTOMER','DELIVERED','FAILED','NOTE'
              )            NOT NULL,
  note        TEXT         NULL,
  lat         DECIMAL(10,8) NULL,
  lng         DECIMAL(11,8) NULL,
  photo_url   VARCHAR(500) NULL,
  created_at  DATETIME     NOT NULL DEFAULT NOW(),
  INDEX idx_order  (order_id),
  INDEX idx_rider  (rider_id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Index ────────────────────────────────────────────────────────
ALTER TABLE orders ADD INDEX idx_rider_id (rider_id);
