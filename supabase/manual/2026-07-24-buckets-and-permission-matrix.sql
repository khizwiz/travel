-- =============================================================================
--  Storage buckets + permission matrix
--  Run in the Supabase SQL editor for project  mbbgbtsfdqiprjrwarwe  (SANDBOX).
--  Do NOT run `supabase db push` — that targets the other project.
--
--  Two things, in one paste because they touch the same policies:
--
--  PART A  creates the storage buckets. They have never existed in this
--          project: no migration in the repo has ever run
--          `insert into storage.buckets`. The buckets were made by hand in the
--          original Lovable dashboard, so this project inherited the *policies*
--          that reference them but not the buckets themselves. That is the
--          "Bucket not found" on story posts and document uploads.
--
--  PART B  rewrites the access rules to match the agreed three-role matrix
--          (public / member / owner) in src/lib/permissions.ts. The app code
--          already enforces it; this is the half the database enforces, and
--          without it the client-side gating is decoration.
--
--  Safe to re-run: every statement is idempotent.
-- =============================================================================


-- =============================================================================
-- PART A — buckets
-- =============================================================================

-- All three are PRIVATE. Reads go through signed URLs, so the trip's documents
-- and receipts are never guessable-by-URL. destination-photos is private too:
-- the public story feed serves signed links for the photos it chooses to show.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents',          'documents',          false, 26214400,
     array['application/pdf','image/jpeg','image/png','image/webp','image/heic']),
  ('receipts',           'receipts',           false, 10485760,
     array['application/pdf','image/jpeg','image/png','image/webp','image/heic']),
  ('destination-photos', 'destination-photos', false, 20971520,
     array['image/jpeg','image/png','image/webp','image/heic','image/avif'])
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = excluded.public;

-- Note on limits: 25 MB documents (scanned passports/insurance run large),
-- 10 MB receipts (phone photos), 20 MB photos. HEIC is included because it is
-- what iPhones produce by default — omitting it silently fails uploads from
-- half the family's phones.

-- 'post-media' is deliberately NOT created. Policies for it exist from an older
-- design, but no code writes to it: StoryUploader uploads to
-- destination-photos. Creating it would just be another thing to keep secure.
-- Its stale policies are dropped in Part B.


-- =============================================================================
-- PART B — access rules
-- =============================================================================

-- ---------------------------------------------------------------------------
-- B1. Stop crew from being indistinguishable from the owner.
--
-- verifyAdminPassword used to insert a user_roles row of 'owner' for the crew
-- account so that has_role()/is_owner() would pass. The effect was that every
-- owner-only policy in this database accepted crew, and the only thing keeping
-- crew out of the owner's documents was a hidden link in the nav.
--
-- The app now writes 'companion' instead. This clears rows already written by
-- the old code.
--
-- !! STOP. Run STEP 1 on its own and read the output before running STEP 2. !!
-- STEP 2 removes 'owner' from every account that is not the address below. If
-- that address is wrong, it removes it from YOU and you lose owner access in
-- the app. The address must equal the OWNER_EMAIL worker secret exactly.
-- ---------------------------------------------------------------------------

-- STEP 1 — look first. Who holds 'owner' today?
select u.email, ur.role, ur.created_at
from public.user_roles ur
join auth.users u on u.id = ur.user_id
where ur.role = 'owner'
order by ur.created_at;

-- Expect exactly two rows right now: the owner, and the crew account
-- (miezko@tripping.local or whatever CREW_EMAIL is set to). If you see only
-- one row and it is the owner, the escalation is already gone — skip STEP 2.

-- STEP 2 — demote everyone who is not the owner. Edit the address first.
-- with owner_email as (select 'glasskomgsm@gmail.com'::text as email)  -- <= CHECK ME
-- update public.user_roles ur
--    set role = 'companion'
--   from auth.users u, owner_email oe
--  where ur.user_id = u.id
--    and ur.role = 'owner'
--    and lower(u.email) is distinct from lower(oe.email);

-- STEP 3 — confirm. This must now list ONLY the owner:
--   select u.email, ur.role from public.user_roles ur
--   join auth.users u on u.id = ur.user_id where ur.role = 'owner';


-- ---------------------------------------------------------------------------
-- B2. documents bucket — members may use documents (matrix: documents.use).
--
-- Was has_role(auth.uid(),'owner'), i.e. owner-only. Combined with the crew
-- escalation above this read as "owner-only" while actually admitting crew.
-- Now it is honestly member-level, which is what the matrix says.
-- ---------------------------------------------------------------------------
drop policy if exists "documents owner select" on storage.objects;
drop policy if exists "documents owner insert" on storage.objects;
drop policy if exists "documents owner update" on storage.objects;
drop policy if exists "documents owner delete" on storage.objects;
drop policy if exists doc_read_own_or_owner   on storage.objects;
drop policy if exists doc_delete_self_or_owner on storage.objects;

create policy documents_member_read on storage.objects
  for select to authenticated
  using (bucket_id = 'documents');

create policy documents_member_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and owner = auth.uid());

create policy documents_owner_or_uploader_update on storage.objects
  for update to authenticated
  using  (bucket_id = 'documents' and (owner = auth.uid() or public.is_owner()))
  with check (bucket_id = 'documents');

create policy documents_owner_or_uploader_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (owner = auth.uid() or public.is_owner()));


-- ---------------------------------------------------------------------------
-- B3. receipts bucket — members may use the cost book (matrix: cost.use),
-- and a receipt is part of recording a cost.
-- ---------------------------------------------------------------------------
drop policy if exists receipts_trip_owner_read on storage.objects;
drop policy if exists receipts_owner_all       on storage.objects;

create policy receipts_member_read on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts');

create policy receipts_member_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and owner = auth.uid());

create policy receipts_owner_or_uploader_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (owner = auth.uid() or public.is_owner()));


-- ---------------------------------------------------------------------------
-- B4. destination-photos — members may post to the story (matrix: story.post).
--
-- Was owner-only for writes, which is why posting a story failed even for a
-- signed-in traveller once the bucket existed.
-- ---------------------------------------------------------------------------
drop policy if exists "destphotos_owner_write" on storage.objects;
drop policy if exists destphotos_public_read   on storage.objects;

create policy destphotos_member_read on storage.objects
  for select to authenticated
  using (bucket_id = 'destination-photos');

create policy destphotos_member_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'destination-photos' and owner = auth.uid());

create policy destphotos_owner_or_uploader_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'destination-photos' and (owner = auth.uid() or public.is_owner()));


-- ---------------------------------------------------------------------------
-- B5. Drop the orphaned post-media policies (no bucket, no code).
-- ---------------------------------------------------------------------------
drop policy if exists pm_delete_author_or_owner on storage.objects;
drop policy if exists pm_read_public            on storage.objects;
drop policy if exists pm_write_author           on storage.objects;


-- =============================================================================
-- Verification — run these afterwards and eyeball the output.
-- =============================================================================

-- 1. Three buckets, all private, with limits:
--   select id, public, file_size_limit, allowed_mime_types
--   from storage.buckets order by id;

-- 2. Exactly one owner:
--   select u.email, ur.role from public.user_roles ur
--   join auth.users u on u.id = ur.user_id where ur.role = 'owner';

-- 3. Storage policies, grouped by bucket:
--   select policyname, cmd, roles from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--   order by policyname;
