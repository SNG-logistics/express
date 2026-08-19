-- SNG Logistics migration 044: proof that real people have used this.
--
-- A trust-dependent service converts on evidence, not on feature lists: an
-- unboxing photo and a customer's own words do more for a first-time buyer than
-- any amount of copy about how careful we are. Purchase-agent orders need this
-- most, because the customer pays a deposit to a service they have not tried.
--
-- Deliberately seeded with nothing. There are no completed purchase-agent orders
-- yet, and inventing a testimonial to fill the space would be a lie told on the
-- exact page whose job is to establish honesty. The panel renders nothing until
-- somebody real has said something real.
--
-- Consent is a column, not an assumption. Publishing a customer's photo or
-- WhatsApp message without asking is both a privacy problem and, for a business
-- built on being trustworthy, a self-inflicted wound. Nothing reaches a customer
-- screen unless consent_given is set AND status is published — two independent
-- gates, so a mis-click on one cannot publish someone who never agreed.
-- consent_note records HOW permission was obtained, so it can be answered for
-- later rather than remembered.

CREATE TABLE IF NOT EXISTS testimonials (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Display name only — a first name or nickname. Never the full name or phone:
  -- the proof works just as well without exposing a customer's identity.
  display_name  VARCHAR(80) NOT NULL,
  -- The customer's own words, in whatever language they wrote them. Not
  -- translated: a rewritten testimonial is no longer their words, and reads it.
  message       TEXT NULL,
  photo_path    VARCHAR(255) NULL,
  -- Which real order this came from. Internal only, never rendered — it exists
  -- so a claim on the public site can always be traced back to something real.
  source_ref    VARCHAR(60) NULL COMMENT 'job_no or quote_no, staff reference only',

  consent_given TINYINT(1) NOT NULL DEFAULT 0,
  consent_note  VARCHAR(255) NULL COMMENT 'how permission was obtained',
  consent_by    BIGINT UNSIGNED NULL,
  consent_at    TIMESTAMP NULL DEFAULT NULL,

  status        ENUM('draft','published','hidden') NOT NULL DEFAULT 'draft',
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_testimonials_live (status, consent_given, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
