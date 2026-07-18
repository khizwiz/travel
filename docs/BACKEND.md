# Backend automation (Supabase via GitHub)

The database is Supabase (Postgres + Auth + Storage). It holds live trip data,
so it stays where it is - but it is now managed **from this repository**, the
way Lovable used to manage it automatically:

- Schema changes are SQL files in `supabase/migrations/`.
- Merging a change to `main` triggers `.github/workflows/db-migrate.yml`,
  which applies pending migrations to the live database.
- Nothing touches the database without appearing in a pull request first.

## One-time setup (repo owner)

Add three secrets at GitHub -> repo -> Settings -> Secrets and variables ->
Actions -> "New repository secret":

| Secret | Where to get it |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens -> Generate new token |
| `SUPABASE_PROJECT_ID` | `addfrnntpkpebdpuqpqf` (project ref, Settings -> General) |
| `SUPABASE_DB_PASSWORD` | Project Settings -> Database -> Reset database password |

Then merge the open pull request. The workflow will run and apply
`20260718120000_splitwise_costs_option_a.sql`, which unlocks cost sharing
for every trip member.

## Day-to-day afterwards

Need a schema change? Add a timestamped `.sql` file to `supabase/migrations/`,
open a PR, merge. The database follows the repository - never the other way
around. To re-run manually, use the workflow's "Run workflow" button
(workflow_dispatch) on the Actions tab.

## Notes

- Lovable-era migrations (before `20260718120000`) are marked as already
  applied on first run, since Lovable executed them directly.
- The deployed app on Cloudflare needs no redeploy after database migrations -
  policies take effect immediately.
