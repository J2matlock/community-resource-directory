-- Emergency pause: when on, the public site shows only the crisis numbers and
-- 211 (owner decision, 2026-10-12). The admin panel keeps working. A backup
-- switch is the SITE_PAUSED setting in the Cloudflare dashboard (HANDOFF.md).
ALTER TABLE site_notice ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
