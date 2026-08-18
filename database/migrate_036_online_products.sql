-- database/migrate_036_online_products.sql
-- Online products catalog: staff-curated deals from any e-commerce platform,
-- shown to members at /member/online, click-through only (SNG never handles
-- the purchase itself). Modeled on migrate_026_directory_shops.sql.

CREATE TABLE IF NOT EXISTS online_products (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  photo_path VARCHAR(255) NULL,
  badge_label VARCHAR(100) NULL,
  discount_pct DECIMAL(5,2) NULL,
  product_url VARCHAR(500) NOT NULL,
  platform ENUM('lazada','shopee','alibaba','tiktok_shop','makro','other') NULL,
  status ENUM('draft', 'published', 'hidden') NOT NULL DEFAULT 'draft',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_online_products_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
