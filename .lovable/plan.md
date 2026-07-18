
## Batch 1 — Foundation & polish (ship first)

**App kickoff July 17, 2026, 05:00 (Europe/Istanbul)**
- Central `APP_KICKOFF` constant in `src/lib/trip-data.ts`
- New `<PreLaunchGate>` in `AppShell` — before kickoff, non-owners see a countdown splash ("Tripping launches July 17, 05:00"). Owner + Miezko bypass.
- Achievements page hidden before kickoff (route redirects to splash).

**Logo — minimal monogram**
- Generate a "Tr" ligature with a route-arc through it (premium tier for legibility).
- Save as `src/assets/logo.png.asset.json` via lovable-assets.
- Replace the "T" chip in `AppShell` sidebar + mobile header.

**Fix `/map` "Open tracking console" link**
- Currently links to `/`; change to `/settings` (owner tracking controls live there) or remove if broken. Verify destination first.

**Hide cost fields in bookings UI**
- Remove `amount` / `currency` from `/bookings` list rendering + booking detail view. Keep them stored + still extracted by AI.

## Batch 2 — Cost, Documents, Checklist

**Cost /cost — fix add-traveller + simplify splitting**
- Debug why "add traveller" fails (likely RLS or missing owner check in `addCostPayer`). Fix.
- Add split-mode: **Equal among selected** only (per your answer). UI: multi-select chips for "Who paid" + multi-select for "Split among".
- Store `payer_id` + `trip_cost_splits` rows. Show per-person balances (who owes who) on the page.

**Documents — folders + AI categorize + replace file**
- Schema: add `folder` text column to `documents` with enum-like values: `identification`, `bookings`, `insurance`, `vehicle`, `medical`, `other`.
- Upload flow: after upload, call Lovable AI with filename + mime → suggest folder. User confirms via dialog (or accepts default).
- UI: folder tabs at top of `/documents`, list filtered per tab.
- "Replace file" button per row: uploads new file to same doc record, updates storage_path.

**Checklist auto-sync from live itinerary**
- Rewrite `/checklist`: instead of hardcoded LISTS, derive items from current + upcoming itinerary days (border crossings, ferry days, flight days, accommodations). Uses `ITINERARY` + overrides via `usePlanOverrides`.
- Static "morning walk-around" list stays; the rest is generated.

## Batch 3 — Daily prompt, GPS badges, full i18n

**Daily tomorrow-destination prompt + GPS-earned badges**
- `DailyPlanPrompt` already exists — extend to also ask "tomorrow's destination" each evening (after 18:00 local).
- New server fn `checkArrivalBadges`: on each `recordLocationPoint`, if user is within 5km of a badge's `after` city coord AND badge unearned → insert `user_badges` row + award 10 pts + push notification.
- Badge model already exists in `src/lib/badges.ts`; add coord lookup + GPS confirmation flag (`earned_by_gps`).

**Full-app language switching**
- Runtime AI translation: new server fn `translateStrings({ strings, target })` → Lovable AI Gateway with cache in `translations` table (key: hash + lang).
- New `<TranslatedText>` component + `useAutoT()` hook that walks children strings and swaps them per active language.
- Wrap key page headings, body copy in existing routes with `<T>...</T>`.
- English stays as-is; TR/PL/IT/etc. translated on demand and cached.
- Note: this affects ~30 files (all routes). It's the biggest single-batch change.

## Sequencing rationale

Batch 1 is small edits, ships fast and validates the plan. Batch 2 is the meaty schema+UI work. Batch 3 is the biggest (i18n reaches everywhere) so goes last with clean footing. Each batch is independently deployable.

**Confirm and I start Batch 1 immediately, then continue through Batch 3 without stopping unless something requires your input (e.g., logo image approval, migration approval).**
