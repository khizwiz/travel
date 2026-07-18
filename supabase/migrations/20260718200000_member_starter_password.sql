-- Owner-visible login help: remember the APP-GENERATED password per member so
-- the trip owner can re-read it when someone forgets. Only ever holds random
-- generated starters (invite / owner reset) — never a password a human chose.
ALTER TABLE public.trip_members
  ADD COLUMN IF NOT EXISTS starter_password text;
