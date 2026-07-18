DROP POLICY IF EXISTS "destphotos_owner_write" ON storage.objects;

CREATE POLICY "destphotos_owner_write"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'destination-photos'
  AND (
    public.is_owner()
    OR EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.owner_id = auth.uid()
        AND (storage.foldername(storage.objects.name))[1] = t.id::text
    )
  )
);