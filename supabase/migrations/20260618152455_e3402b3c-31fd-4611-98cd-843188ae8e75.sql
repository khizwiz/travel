
-- documents bucket: path layout {trip_id}/{owner_id}/{filename}
CREATE POLICY "doc_read_own_or_owner"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents' AND (
      (storage.foldername(name))[2] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM public.trips t
        WHERE t.id::text = (storage.foldername(name))[1]
          AND t.owner_id = auth.uid()
      )
    )
  );

CREATE POLICY "doc_write_self"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "doc_update_self"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "doc_delete_self_or_owner"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents' AND (
      (storage.foldername(name))[2] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM public.trips t
        WHERE t.id::text = (storage.foldername(name))[1]
          AND t.owner_id = auth.uid()
      )
    )
  );

-- post-media bucket: path {trip_id}/{post_id}/{filename}
CREATE POLICY "pm_read_member"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'post-media'
    AND public.is_member_of((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY "pm_write_member"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'post-media'
    AND public.is_member_of((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY "pm_delete_member"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'post-media'
    AND public.is_member_of((storage.foldername(name))[1]::uuid)
  );
