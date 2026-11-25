BEGIN;
-- Google resources provisioned automatically in each user's own Drive.
-- Unique constraints guarantee no two accounts ever resolve to the same course binding or file.
CREATE TABLE IF NOT EXISTS bird.workspaces (
  user_id uuid PRIMARY KEY REFERENCES bird.users(id) ON DELETE CASCADE,
  course_id text,
  course_name text,
  root_folder_id text UNIQUE,
  reports_folder_id text UNIQUE,
  plan_sheet_id text UNIQUE,
  sci_plan_sheet_id text UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA bird FROM PUBLIC;
COMMIT;
