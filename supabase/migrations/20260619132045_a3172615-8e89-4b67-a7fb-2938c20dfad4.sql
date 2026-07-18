
CREATE POLICY "receipts_owner_all"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'receipts' AND public.is_owner())
  WITH CHECK (bucket_id = 'receipts' AND public.is_owner());

CREATE POLICY "receipts_self_write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND owner = auth.uid());

CREATE POLICY "receipts_self_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND owner = auth.uid());

CREATE POLICY "destphotos_auth_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'destination-photos');

CREATE POLICY "destphotos_owner_write"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'destination-photos' AND public.is_owner())
  WITH CHECK (bucket_id = 'destination-photos' AND public.is_owner());
