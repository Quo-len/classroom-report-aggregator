BEGIN;
ALTER TABLE bird.runs DROP CONSTRAINT IF EXISTS runs_user_id_course_id_assignment_id_phase_key;
CREATE INDEX IF NOT EXISTS runs_assignment_phase ON bird.runs (user_id, course_id, assignment_id, phase, started_at DESC);
CREATE TABLE IF NOT EXISTS bird.telegram_bindings (
  user_id uuid PRIMARY KEY REFERENCES bird.users(id) ON DELETE CASCADE,
  token_hash text UNIQUE,
  expires_at timestamptz,
  chat_id text
);
COMMIT;
