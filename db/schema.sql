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

-- Money owed between people — not part of expense heads
CREATE TABLE IF NOT EXISTS debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('owed_to_me', 'i_owe')),
  amount NUMERIC(12, 2),
  note TEXT,
  recorded_on DATE NOT NULL DEFAULT CURRENT_DATE,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT debts_person_not_blank CHECK (char_length(trim(person_name)) > 0)
);

CREATE INDEX IF NOT EXISTS debts_user_id_idx ON debts(user_id);
CREATE INDEX IF NOT EXISTS debts_open_idx ON debts(user_id, settled_at);

-- Older installs required amount on debts; totals now come from debt_items
ALTER TABLE debts ALTER COLUMN amount DROP NOT NULL;

-- Multiple line items (amount + description) under one owed person
CREATE TABLE IF NOT EXISTS debt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id UUID NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  recorded_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT debt_items_description_not_blank CHECK (char_length(trim(description)) > 0)
);

CREATE INDEX IF NOT EXISTS debt_items_debt_id_idx ON debt_items(debt_id);

-- Existing single-amount debts become one line item
INSERT INTO debt_items (debt_id, amount, description, recorded_on)
SELECT
  d.id,
  d.amount,
  COALESCE(NULLIF(trim(d.note), ''), 'Balance'),
  d.recorded_on
FROM debts d
WHERE d.amount IS NOT NULL
  AND d.amount > 0
  AND NOT EXISTS (SELECT 1 FROM debt_items i WHERE i.debt_id = d.id);
