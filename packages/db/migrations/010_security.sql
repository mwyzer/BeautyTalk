-- 010_security.sql
-- Account lockout: track failed login attempts and lock accounts temporarily.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;