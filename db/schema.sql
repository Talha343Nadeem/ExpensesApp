CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'PKR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS heads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES heads(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT heads_name_not_blank CHECK (char_length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS heads_user_id_idx ON heads(user_id);
CREATE INDEX IF NOT EXISTS heads_parent_id_idx ON heads(parent_id);

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  head_id UUID NOT NULL REFERENCES heads(id) ON DELETE RESTRICT,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  spent_on DATE NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expenses_user_month_idx ON expenses(user_id, spent_on);
CREATE INDEX IF NOT EXISTS expenses_head_id_idx ON expenses(head_id);

CREATE TABLE IF NOT EXISTS limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  head_id UUID NOT NULL REFERENCES heads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('count', 'money')),
  cap NUMERIC(12, 2) NOT NULL CHECK (cap > 0),
  period TEXT NOT NULL CHECK (period IN ('week', 'month')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (head_id, kind)
);

CREATE INDEX IF NOT EXISTS limits_user_id_idx ON limits(user_id);
CREATE INDEX IF NOT EXISTS limits_head_id_idx ON limits(head_id);
