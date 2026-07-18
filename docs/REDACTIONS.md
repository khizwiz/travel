# Redactions in this public repository

Two real email addresses were replaced with placeholders before publishing:

- Trip owner's Gmail  -> `owner@example.com`
- Trip member's Gmail -> `member1@example.com`

Affected: `src/lib/access.functions.ts`, `src/lib/admin-auth.functions.ts`,
`src/lib/push.functions.ts`, `src/lib/trip-data.ts`,
`src/routes/api/public/hooks/booking-reminders.ts`,
`supabase/migrations/20260618152006_*.sql`.

The live Supabase database still contains the real values, so the deployed
app is unaffected. If you re-run these migrations or redeploy auth logic
from this repo, restore the real addresses locally first (do NOT commit
them) - or better, refactor them into environment variables.

The `.env` file was removed; see `.env.example` for the required keys.
