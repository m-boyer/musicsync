-- Account credentials, always encrypted. The key lives outside the database.
CREATE TABLE credentials (
  service text PRIMARY KEY CHECK (service IN ('apple', 'youtube')),
  ciphertext text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode text NOT NULL DEFAULT 'dry-run' CHECK (mode IN ('dry-run', 'add-only', 'full')),
  interval_seconds integer NOT NULL DEFAULT 300 CHECK (interval_seconds >= 60),
  max_ops_per_cycle integer NOT NULL DEFAULT 25 CHECK (max_ops_per_cycle > 0),
  max_deletes_per_cycle integer NOT NULL DEFAULT 5 CHECK (max_deletes_per_cycle >= 0),
  add_grace_minutes integer NOT NULL DEFAULT 30 CHECK (add_grace_minutes > 0),
  match_threshold real NOT NULL DEFAULT 0.8 CHECK (match_threshold BETWEEN 0 AND 1),
  apple_storefront text NOT NULL DEFAULT 'us',
  apple_base_url text,
  apple_user_token_header text NOT NULL DEFAULT 'Music-User-Token',
  apple_delete_verified_at timestamptz,
  youtube_delete_verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (id) VALUES (1);

CREATE TABLE probe_runs (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('read', 'write')),
  status text NOT NULL CHECK (status IN ('running', 'finished', 'interrupted')),
  steps jsonb NOT NULL DEFAULT '[]',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

ALTER TABLE match_results DROP CONSTRAINT match_results_status_check;
ALTER TABLE match_results ADD CONSTRAINT match_results_status_check CHECK (status IN ('matched', 'pending', 'ignored'));
