BEGIN;
-- Role-based access control. Every row in bird.* stays owned by exactly one user;
-- roles decide what that user may do with their own data and whether they may manage other accounts.
ALTER TABLE bird.users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'editor'
  CHECK (role IN ('admin', 'editor', 'viewer', 'disabled'));

-- Existing deployments: the earliest account becomes the first administrator.
UPDATE bird.users SET role = 'admin'
WHERE id = (SELECT id FROM bird.users ORDER BY created_at, id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM bird.users WHERE role = 'admin');

CREATE TABLE IF NOT EXISTS bird.audit_log (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES bird.users(id) ON DELETE SET NULL,
  target_id uuid REFERENCES bird.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_at ON bird.audit_log(created_at DESC);
REVOKE ALL ON ALL TABLES IN SCHEMA bird FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA bird FROM PUBLIC;
COMMIT;
