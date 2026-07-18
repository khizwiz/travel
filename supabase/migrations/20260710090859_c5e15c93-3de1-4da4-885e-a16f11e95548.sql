
-- Owner-only storage policies for the private "documents" bucket.
DROP POLICY IF EXISTS "documents owner select" ON storage.objects;
DROP POLICY IF EXISTS "documents owner insert" ON storage.objects;
DROP POLICY IF EXISTS "documents owner update" ON storage.objects;
DROP POLICY IF EXISTS "documents owner delete" ON storage.objects;

CREATE POLICY "documents owner select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND public.has_role(auth.uid(), 'owner'));

CREATE POLICY "documents owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND public.has_role(auth.uid(), 'owner'));

CREATE POLICY "documents owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'documents' AND public.has_role(auth.uid(), 'owner'))
  WITH CHECK (bucket_id = 'documents' AND public.has_role(auth.uid(), 'owner'));

CREATE POLICY "documents owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND public.has_role(auth.uid(), 'owner'));
