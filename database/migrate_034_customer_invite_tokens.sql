-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 034: Customer Invite Tokens
-- ═══════════════════════════════════════════════════════════════════════
-- Staff "invite to become a member" (customersController.inviteMember)
-- previously would have needed to put the customer's raw phone number in
-- the WhatsApp invite link's query string (/register?phone=...) for the
-- register page to pre-fill it — but that leaves the phone sitting in
-- browser history, access logs, and Referer headers. Instead: the invite
-- link carries only an opaque, random, single-purpose token; the actual
-- phone never leaves the server until the token is redeemed.
-- Safe to run multiple times (INFORMATION_SCHEMA guard).
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS customer_invite_tokens (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  token CHAR(48) NOT NULL COMMENT 'random hex, crypto.randomBytes(24) — unguessable, not a signed/decodable payload',
  phone VARCHAR(30) NOT NULL COMMENT 'toWaPhone-normalized',
  country_code VARCHAR(3) NOT NULL COMMENT '66 or 856 — lets the register form pre-select the right country tab',
  customer_id BIGINT UNSIGNED NULL COMMENT 'the customers row this invite was sent from, for staff traceability only',
  created_by BIGINT UNSIGNED NOT NULL COMMENT 'users.id — staff who sent the invite',
  expires_at TIMESTAMP NOT NULL COMMENT 'short-lived — see INVITE_TOKEN_TTL_HOURS in inviteTokenService.js',
  consumed_at TIMESTAMP NULL COMMENT 'set when the register page actually reads it; token stays valid for repeat visits until expiry regardless',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cit_token (token),
  KEY idx_cit_expires (expires_at),
  CONSTRAINT fk_cit_customer FOREIGN KEY (customer_id)
    REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_cit_staff FOREIGN KEY (created_by)
    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Short-lived opaque tokens for member-registration invite links, so a customer phone number never has to appear in a URL';
