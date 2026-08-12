-- Tables and minimum reference data previously created only during app startup.

CREATE TABLE IF NOT EXISTS exchange_rates (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  pair VARCHAR(10) NOT NULL DEFAULT 'THB_LAK',
  rate DECIMAL(12,4) NOT NULL,
  set_by BIGINT UNSIGNED NULL,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_exchange_rates_pair_created (pair, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Seed the same starter rates used by the current SNG installation only when
-- a new installation has no pricing rows at all. Administrators can edit or
-- deactivate them from Settings before accepting production orders.
INSERT INTO shipping_rates (name, max_weight, max_dimension, price, price_per_kg, active)
SELECT seed.name, seed.max_weight, seed.max_dimension, seed.price, seed.price_per_kg, 1
FROM (
  SELECT 'A' AS name, 1.00 AS max_weight, 30 AS max_dimension, 30.00 AS price, 0.00 AS price_per_kg
  UNION ALL SELECT 'A+', 2.00, 40, 40.00, 0.00
  UNION ALL SELECT 'ของใช้ทั่วไป', 10.00, 30, 30.00, 0.00
  UNION ALL SELECT 'เสื้อผ้า', 10.00, 30, 30.00, 0.00
  UNION ALL SELECT 'เฟอร์นิเจอร์', 10.00, 30, 30.00, 0.00
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM shipping_rates LIMIT 1);
