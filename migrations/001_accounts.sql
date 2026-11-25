BEGIN;
CREATE SCHEMA IF NOT EXISTS bird;
REVOKE ALL ON SCHEMA bird FROM PUBLIC;

CREATE TABLE IF NOT EXISTS bird.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub text UNIQUE NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  tokens text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bird.settings (
  user_id uuid PRIMARY KEY REFERENCES bird.users(id) ON DELETE CASCADE,
  value jsonb NOT NULL,
  automation_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bird.sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES bird.users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON bird.sessions(user_id);
CREATE TABLE IF NOT EXISTS bird.oauth_attempts (
  state_hash text PRIMARY KEY,
  binding_hash text NOT NULL,
  verifier text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS bird.reports (
  user_id uuid NOT NULL REFERENCES bird.users(id) ON DELETE CASCADE,
  course_id text NOT NULL,
  assignment_id text NOT NULL,
  spreadsheet_id text NOT NULL,
  PRIMARY KEY (user_id, course_id, assignment_id)
);
CREATE TABLE IF NOT EXISTS bird.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES bird.users(id) ON DELETE CASCADE,
  course_id text NOT NULL,
  assignment_id text NOT NULL,
  phase text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'needs_review')),
  sheet_url text,
  message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (user_id, course_id, assignment_id, phase)
);
CREATE TABLE IF NOT EXISTS bird.deliveries (
  run_id uuid NOT NULL REFERENCES bird.runs(id) ON DELETE CASCADE,
  delivery_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'uncertain')),
  PRIMARY KEY (run_id, delivery_key)
);
REVOKE ALL ON ALL TABLES IN SCHEMA bird FROM PUBLIC;
COMMIT;
