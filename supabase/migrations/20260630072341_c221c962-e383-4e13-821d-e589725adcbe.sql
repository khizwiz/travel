
-- 1. Fix documents storage policies (use objects.name, not t.name)
DROP POLICY IF EXISTS doc_read_own_or_owner ON storage.objects;
CREATE POLICY doc_read_own_or_owner ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    (storage.foldername(name))[2] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id::text = (storage.foldername(objects.name))[1]
        AND t.owner_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS doc_delete_self_or_owner ON storage.objects;
CREATE POLICY doc_delete_self_or_owner ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    (storage.foldername(name))[2] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id::text = (storage.foldername(objects.name))[1]
        AND t.owner_id = auth.uid()
    )
  )
);

-- 2. Profiles: expose a safe, co-member-readable view (display_name + avatar only)
CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = on) AS
SELECT p.id, p.display_name, p.avatar_url
FROM public.profiles p
WHERE p.id = auth.uid()
   OR public.is_owner()
   OR public.shares_trip_with(p.id);

GRANT SELECT ON public.profiles_public TO authenticated;

-- 3. Receipts: allow trip owners to read receipts that are referenced
--    by their trip's costs. Path layout is "{user_id}/{filename}", but
--    we link via trip_costs.receipt_path rather than guessing the path.
DROP POLICY IF EXISTS receipts_trip_owner_read ON storage.objects;
CREATE POLICY receipts_trip_owner_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'receipts'
  AND EXISTS (
    SELECT 1
    FROM public.trip_costs tc
    JOIN public.trips t ON t.id = tc.trip_id
    WHERE tc.receipt_path = objects.name
      AND t.owner_id = auth.uid()
  )
);
