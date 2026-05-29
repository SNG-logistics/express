-- ─────────────────────────────────────────────────────────────────────────────
-- migrate_crm_001.sql
-- Omnichannel CRM module — initial schema
--
-- Run: mysql -u <user> -p <db_name> < database/migrate_crm_001.sql
-- Safe to run multiple times (IF NOT EXISTS + IF NOT EXISTS guards used)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Extend users.role ENUM with CRM roles
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE users MODIFY COLUMN role ENUM(
  'admin','staff','manager','dispatcher','finance','customs',
  'warehouse_th','warehouse_la','branch_operator','customer_service',
  'driver_support','rider',
  -- CRM roles (new)
  'crm_admin','crm_supervisor','crm_agent',
  'sales_agent','logistics_support','finance_support'
) NOT NULL DEFAULT 'staff';

-- Extend status ENUM if not already done
ALTER TABLE users MODIFY COLUMN status ENUM('active','inactive','disabled') NOT NULL DEFAULT 'active';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. crm_channels — registered channel accounts (FB Page, WA number, LINE OA)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_channels (
  id                      INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  channel_type            ENUM('FACEBOOK','WHATSAPP','LINE_OA') NOT NULL,
  channel_name            VARCHAR(120) NOT NULL COMMENT 'Display name e.g. "SNG Express FB"',
  external_account_id     VARCHAR(200) NOT NULL COMMENT 'FB page_id / WA phone_number_id / LINE channelId',
  access_token_encrypted  TEXT NULL    COMMENT 'Encrypted access token',
  refresh_token_encrypted TEXT NULL,
  webhook_secret          VARCHAR(255) NULL,
  is_active               TINYINT(1) NOT NULL DEFAULT 1,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_crm_ch_type (channel_type),
  KEY idx_crm_ch_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Registered messaging channel accounts';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. crm_customers — CRM customer record (may link to existing customers table)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_customers (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  legacy_customer_id BIGINT UNSIGNED NULL COMMENT 'FK to existing customers.id if matched',
  customer_code     VARCHAR(30) NULL COMMENT 'Human-readable CRM code e.g. CRM-00123',
  full_name         VARCHAR(200) NOT NULL,
  phone             VARCHAR(30) NULL,
  email             VARCHAR(120) NULL,
  country           VARCHAR(60) NULL,
  province          VARCHAR(120) NULL,
  district          VARCHAR(120) NULL,
  address           TEXT NULL,
  preferred_language ENUM('th','lo','en') NOT NULL DEFAULT 'th',
  customer_type     ENUM('LEAD','CUSTOMER','VIP','BLACKLIST') NOT NULL DEFAULT 'CUSTOMER',
  note              TEXT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_crm_cust_phone (phone),
  KEY idx_crm_cust_type (customer_type),
  KEY idx_crm_cust_legacy (legacy_customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CRM unified customer record';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. crm_customer_identities — one customer = many channel accounts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_customer_identities (
  id                    BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  crm_customer_id       BIGINT UNSIGNED NOT NULL,
  channel_type          ENUM('FACEBOOK','WHATSAPP','LINE_OA') NOT NULL,
  channel_id            INT UNSIGNED NULL COMMENT 'FK to crm_channels.id',
  external_user_id      VARCHAR(200) NOT NULL COMMENT 'FB PSID / WA number / LINE userId',
  external_display_name VARCHAR(200) NULL,
  external_avatar_url   TEXT NULL,
  phone_normalized      VARCHAR(30) NULL,
  linked_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_primary            TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_crm_ident_customer FOREIGN KEY (crm_customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE,
  UNIQUE KEY uq_crm_ident (channel_type, external_user_id),
  KEY idx_crm_ident_customer (crm_customer_id),
  KEY idx_crm_ident_phone (phone_normalized)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Links CRM customer to channel-specific user IDs';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. crm_queues — routing queues
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_queues (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  queue_name  VARCHAR(80) NOT NULL,
  queue_type  ENUM('SALES','LOGISTICS','FINANCE','GENERAL_SUPPORT','VIP') NOT NULL DEFAULT 'GENERAL_SUPPORT',
  description VARCHAR(255) NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Conversation routing queues';

-- Seed default queues
INSERT IGNORE INTO crm_queues (id, queue_name, queue_type) VALUES
  (1, 'ทีม Logistics', 'LOGISTICS'),
  (2, 'ทีม Sales', 'SALES'),
  (3, 'ทีม Finance', 'FINANCE'),
  (4, 'ทีม General', 'GENERAL_SUPPORT'),
  (5, 'ลูกค้า VIP', 'VIP');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. crm_conversations — one chat thread per channel conversation
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_conversations (
  id                        BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  crm_customer_id           BIGINT UNSIGNED NOT NULL,
  channel_type              ENUM('FACEBOOK','WHATSAPP','LINE_OA') NOT NULL,
  channel_id                INT UNSIGNED NULL COMMENT 'FK to crm_channels.id',
  external_conversation_id  VARCHAR(200) NULL COMMENT 'Channel-specific thread/conversation ID',
  subject                   VARCHAR(255) NULL,
  status                    ENUM('OPEN','PENDING','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
  priority                  ENUM('LOW','NORMAL','HIGH','URGENT') NOT NULL DEFAULT 'NORMAL',
  queue_id                  INT UNSIGNED NULL,
  assigned_agent_id         BIGINT UNSIGNED NULL COMMENT 'FK to users.id',
  assigned_team_id          INT UNSIGNED NULL COMMENT 'FK to crm_queues.id',
  first_message_at          TIMESTAMP NULL,
  last_message_at           TIMESTAMP NULL,
  first_response_at         TIMESTAMP NULL COMMENT 'First agent response time (for SLA)',
  resolved_at               TIMESTAMP NULL,
  sla_due_at                TIMESTAMP NULL COMMENT 'Deadline for first response',
  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_crm_conv_customer FOREIGN KEY (crm_customer_id) REFERENCES crm_customers(id),
  CONSTRAINT fk_crm_conv_agent    FOREIGN KEY (assigned_agent_id) REFERENCES users(id) ON DELETE SET NULL,
  KEY idx_crm_conv_status   (status),
  KEY idx_crm_conv_queue    (queue_id),
  KEY idx_crm_conv_agent    (assigned_agent_id),
  KEY idx_crm_conv_customer (crm_customer_id),
  KEY idx_crm_conv_channel  (channel_type),
  KEY idx_crm_conv_sla      (sla_due_at),
  KEY idx_crm_conv_last_msg (last_message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CRM conversation threads';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. crm_messages — all messages in a conversation
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_messages (
  id                    BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  conversation_id       BIGINT UNSIGNED NOT NULL,
  sender_type           ENUM('CUSTOMER','AGENT','SYSTEM','BOT') NOT NULL,
  sender_user_id        BIGINT UNSIGNED NULL COMMENT 'FK to users.id when sender_type=AGENT',
  sender_name           VARCHAR(200) NULL,
  message_type          ENUM('TEXT','IMAGE','FILE','AUDIO','VIDEO','LOCATION','TEMPLATE','STICKER') NOT NULL DEFAULT 'TEXT',
  content_text          TEXT NULL,
  attachment_url        TEXT NULL,
  attachment_name       VARCHAR(255) NULL,
  external_message_id   VARCHAR(200) NULL COMMENT 'Channel message ID for dedup',
  reply_to_message_id   BIGINT UNSIGNED NULL,
  delivery_status       ENUM('SENDING','SENT','DELIVERED','READ','FAILED') NOT NULL DEFAULT 'SENT',
  sent_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_crm_msg_conv   FOREIGN KEY (conversation_id) REFERENCES crm_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_msg_sender FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL,
  KEY idx_crm_msg_conv    (conversation_id),
  KEY idx_crm_msg_sent_at (sent_at),
  KEY idx_crm_msg_ext_id  (external_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CRM chat messages';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. crm_tags — label taxonomy
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_tags (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  tag_name    VARCHAR(80) NOT NULL UNIQUE,
  tag_color   VARCHAR(20) NOT NULL DEFAULT '#6366f1' COMMENT 'Hex color for UI badge',
  tag_group   VARCHAR(60) NULL COMMENT 'Optional grouping e.g. "logistics","sales"',
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CRM conversation tags';

-- Seed default tags
INSERT IGNORE INTO crm_tags (tag_name, tag_color, tag_group) VALUES
  ('ถามสถานะพัสดุ',  '#3b82f6', 'logistics'),
  ('ทวงของ',          '#ef4444', 'logistics'),
  ('เปลี่ยนที่อยู่',   '#f59e0b', 'logistics'),
  ('COD',             '#10b981', 'finance'),
  ('สนใจสินค้า',      '#8b5cf6', 'sales'),
  ('VIP',             '#f59e0b', 'vip'),
  ('เคสร้องเรียน',    '#ef4444', 'complaint'),
  ('แจ้งของหาย',      '#dc2626', 'complaint'),
  ('ของเสียหาย',      '#dc2626', 'complaint'),
  ('ต้องการใบเสร็จ',  '#64748b', 'finance');

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. crm_conversation_tags — M:N conversation ↔ tag
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_conversation_tags (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  tag_id          INT UNSIGNED NOT NULL,
  tagged_by       BIGINT UNSIGNED NULL COMMENT 'FK to users.id',
  tagged_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_crm_ctag_conv FOREIGN KEY (conversation_id) REFERENCES crm_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_ctag_tag  FOREIGN KEY (tag_id) REFERENCES crm_tags(id) ON DELETE CASCADE,
  UNIQUE KEY uq_crm_conv_tag (conversation_id, tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. crm_cases — support ticket / case
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_cases (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  case_no             VARCHAR(30) NOT NULL COMMENT 'e.g. CASE-20260001',
  conversation_id     BIGINT UNSIGNED NULL,
  crm_customer_id     BIGINT UNSIGNED NOT NULL,
  related_order_id    BIGINT UNSIGNED NULL COMMENT 'FK to orders.id',
  related_job_no      VARCHAR(50) NULL COMMENT 'Denormalized for quick reference',
  case_type           ENUM(
                        'TRACKING_ISSUE','DELAYED_DELIVERY','CHANGE_ADDRESS',
                        'COD_ISSUE','MISSING_ITEM','DAMAGED_ITEM',
                        'PRODUCT_INQUIRY','PAYMENT_ISSUE','OTHER'
                      ) NOT NULL DEFAULT 'OTHER',
  case_status         ENUM('OPEN','IN_PROGRESS','WAITING','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
  priority            ENUM('LOW','NORMAL','HIGH','URGENT') NOT NULL DEFAULT 'NORMAL',
  subject             VARCHAR(255) NOT NULL,
  description         TEXT NULL,
  assigned_to         BIGINT UNSIGNED NULL COMMENT 'FK to users.id',
  resolution_note     TEXT NULL,
  opened_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at         TIMESTAMP NULL,
  closed_at           TIMESTAMP NULL,
  created_by          BIGINT UNSIGNED NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_crm_case_conv     FOREIGN KEY (conversation_id) REFERENCES crm_conversations(id) ON DELETE SET NULL,
  CONSTRAINT fk_crm_case_customer FOREIGN KEY (crm_customer_id) REFERENCES crm_customers(id),
  CONSTRAINT fk_crm_case_order    FOREIGN KEY (related_order_id) REFERENCES orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_crm_case_agent    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  KEY idx_crm_case_status   (case_status),
  KEY idx_crm_case_customer (crm_customer_id),
  KEY idx_crm_case_order    (related_order_id),
  KEY idx_crm_case_no       (case_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CRM support tickets/cases';

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. crm_internal_notes — agent-only notes on a conversation
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_internal_notes (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  created_by      BIGINT UNSIGNED NOT NULL COMMENT 'FK to users.id',
  note_text       TEXT NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_crm_note_conv FOREIGN KEY (conversation_id) REFERENCES crm_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_note_user FOREIGN KEY (created_by) REFERENCES users(id),
  KEY idx_crm_note_conv (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Internal agent notes (not visible to customer)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. crm_quick_replies — canned response library
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_quick_replies (
  id            INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  title         VARCHAR(120) NOT NULL,
  shortcut_key  VARCHAR(30) NULL COMMENT 'e.g. /tracking',
  content_text  TEXT NOT NULL,
  language      ENUM('th','lo','en') NOT NULL DEFAULT 'th',
  category      VARCHAR(60) NULL COMMENT 'e.g. "logistics","greeting"',
  created_by    BIGINT UNSIGNED NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_crm_qr_shortcut (shortcut_key),
  KEY idx_crm_qr_lang (language)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Canned quick reply messages';

-- Seed sample quick replies
INSERT IGNORE INTO crm_quick_replies (title, shortcut_key, content_text, category) VALUES
  ('ทักทายลูกค้า', '/hi',
   'สวัสดีครับ/ค่ะ ยินดีต้อนรับสู่ SNG Express มีอะไรให้ช่วยเหลือครับ/ค่ะ?',
   'greeting'),
  ('ขอข้อมูลพัสดุ', '/tracking',
   'กรุณาแจ้งหมายเลข Job No. ของพัสดุให้ทราบด้วยนะครับ/ค่ะ',
   'logistics'),
  ('ของอยู่ระหว่างขนส่ง', '/enroute',
   'พัสดุของคุณอยู่ระหว่างการขนส่งครับ/ค่ะ คาดว่าจะถึงภายใน 2-3 วันทำการ',
   'logistics'),
  ('ติดต่อฝ่าย COD', '/cod',
   'กรุณาติดต่อฝ่ายการเงินเพื่อตรวจสอบยอด COD ครับ/ค่ะ',
   'finance'),
  ('ขอโทษล่าช้า', '/sorry',
   'ขออภัยในความล่าช้าครับ/ค่ะ ทางเราจะเร่งดำเนินการให้โดยเร็วที่สุด',
   'complaint');

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. crm_assignments — conversation assignment history
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_assignments (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  from_user_id    BIGINT UNSIGNED NULL,
  to_user_id      BIGINT UNSIGNED NULL,
  from_queue_id   INT UNSIGNED NULL,
  to_queue_id     INT UNSIGNED NULL,
  reason          VARCHAR(255) NULL,
  assigned_by     BIGINT UNSIGNED NULL COMMENT 'Who performed the assignment',
  assigned_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_crm_assign_conv FOREIGN KEY (conversation_id) REFERENCES crm_conversations(id) ON DELETE CASCADE,
  KEY idx_crm_assign_conv (conversation_id),
  KEY idx_crm_assign_at   (assigned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Conversation reassignment history';

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. crm_sla_rules — SLA configuration per queue
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_sla_rules (
  id                      INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  queue_id                INT UNSIGNED NULL COMMENT 'NULL = default rule for all queues',
  rule_name               VARCHAR(80) NOT NULL,
  first_response_minutes  INT NOT NULL DEFAULT 60  COMMENT 'Max minutes for first response',
  resolution_minutes      INT NOT NULL DEFAULT 1440 COMMENT 'Max minutes for full resolution (1440=24h)',
  active_hours_start      TIME NOT NULL DEFAULT '08:00:00',
  active_hours_end        TIME NOT NULL DEFAULT '18:00:00',
  active_days_json        JSON NULL COMMENT 'e.g. [1,2,3,4,5] = Mon-Fri',
  is_active               TINYINT(1) NOT NULL DEFAULT 1,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_crm_sla_queue (queue_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SLA rules per queue';

-- Seed default SLA rules
INSERT IGNORE INTO crm_sla_rules (id, queue_id, rule_name, first_response_minutes, resolution_minutes) VALUES
  (1, NULL, 'Default SLA', 60, 1440),
  (2, 1, 'Logistics SLA', 30, 720),
  (3, 2, 'Sales SLA', 60, 2880),
  (4, 5, 'VIP SLA', 15, 480);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. crm_automation_rules — keyword/condition → action rules
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_automation_rules (
  id              INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  rule_name       VARCHAR(120) NOT NULL,
  description     VARCHAR(255) NULL,
  trigger_type    ENUM('NEW_CONVERSATION','NEW_MESSAGE','STATUS_CHANGE','SLA_BREACH') NOT NULL DEFAULT 'NEW_MESSAGE',
  conditions_json JSON NOT NULL COMMENT 'Array of condition objects [{field,operator,value}]',
  actions_json    JSON NOT NULL COMMENT 'Array of action objects [{type,params}]',
  priority        INT NOT NULL DEFAULT 10 COMMENT 'Lower = evaluated first',
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_by      BIGINT UNSIGNED NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_crm_auto_trigger (trigger_type),
  KEY idx_crm_auto_active  (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CRM automation rules engine';

-- Seed sample automation rules
INSERT IGNORE INTO crm_automation_rules (rule_name, trigger_type, conditions_json, actions_json, priority) VALUES
  ('Route logistics queries',
   'NEW_MESSAGE',
   '[{"field":"message_text","operator":"contains_any","value":["ของถึงไหน","สถานะพัสดุ","tracking","ทวงของ","ของหาย"]}]',
   '[{"type":"assign_queue","params":{"queue_id":1}},{"type":"add_tag","params":{"tag_name":"ถามสถานะพัสดุ"}}]',
   10),
  ('Route sales queries',
   'NEW_MESSAGE',
   '[{"field":"message_text","operator":"contains_any","value":["ราคา","สั่งของ","สินค้า","โปรโมชั่น","ส่วนลด"]}]',
   '[{"type":"assign_queue","params":{"queue_id":2}},{"type":"add_tag","params":{"tag_name":"สนใจสินค้า"}}]',
   20),
  ('Route COD queries',
   'NEW_MESSAGE',
   '[{"field":"message_text","operator":"contains_any","value":["COD","เก็บเงินปลายทาง","ยอดโอน"]}]',
   '[{"type":"assign_queue","params":{"queue_id":3}},{"type":"add_tag","params":{"tag_name":"COD"}}]',
   30),
  ('Alert on SLA breach',
   'SLA_BREACH',
   '[]',
   '[{"type":"notify_supervisor","params":{"message":"SLA เกินกำหนด กรุณาตรวจสอบ"}}]',
   1);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification query (run manually)
-- ─────────────────────────────────────────────────────────────────────────────
-- SHOW TABLES LIKE 'crm_%';
-- SELECT COUNT(*) FROM crm_queues;
-- SELECT COUNT(*) FROM crm_tags;
-- SELECT COUNT(*) FROM crm_quick_replies;
-- SELECT COUNT(*) FROM crm_automation_rules;
