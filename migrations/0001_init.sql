-- A song known on both services. A null seen_at means it was added there and has not shown up yet.
CREATE TABLE track_links (
  apple_id text NOT NULL UNIQUE,
  youtube_id text NOT NULL UNIQUE,
  apple_seen_at timestamptz,
  youtube_seen_at timestamptz,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (apple_id, youtube_id)
);

-- Result of looking a song up in the other catalog, so it is not searched again every cycle.
CREATE TABLE match_results (
  service text NOT NULL CHECK (service IN ('apple', 'youtube')),
  source_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('matched', 'pending')),
  title text NOT NULL,
  artist text NOT NULL,
  target_id text,
  target_title text,
  target_artist text,
  score real,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service, source_id)
);

CREATE TABLE sync_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  mode text NOT NULL,
  status text NOT NULL,
  summary jsonb NOT NULL
);

CREATE INDEX sync_runs_started_at_idx ON sync_runs (started_at DESC);
