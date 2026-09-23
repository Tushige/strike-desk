CREATE TABLE completed_games (
  environment text NOT NULL CHECK (environment IN ('development', 'production')),
  run_id text NOT NULL CHECK (length(run_id) = 64),
  completed_at timestamptz NOT NULL,
  engine_version text NOT NULL,
  content_version text NOT NULL,
  pace numeric NOT NULL CHECK (pace IN (1, 3, 7.5)),
  starting_cash_cents bigint NOT NULL CHECK (starting_cash_cents >= 0),
  final_cash_cents bigint NOT NULL CHECK (final_cash_cents >= 0),
  purchases smallint NOT NULL CHECK (purchases BETWEEN 0 AND 15),
  PRIMARY KEY (environment, run_id)
);
