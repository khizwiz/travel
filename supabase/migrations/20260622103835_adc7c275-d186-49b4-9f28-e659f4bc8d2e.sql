
-- Tighten profiles SELECT: only self or platform owner can read full row (email/phone)
DROP POLICY IF EXISTS profiles_trip_owner_read ON public.profiles;
CREATE POLICY profiles_self_or_owner_read ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_owner());

-- Tighten post-media DELETE: only the uploader or platform owner can delete
DROP POLICY IF EXISTS pm_delete_member ON storage.objects;
CREATE POLICY pm_delete_author_or_owner ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'post-media'
    AND (owner = auth.uid() OR public.is_owner())
  );
