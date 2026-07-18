
-- 1. comments insert: require membership or public post visibility
DROP POLICY IF EXISTS cm_auth_insert ON public.comments;
CREATE POLICY cm_auth_insert ON public.comments
FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = comments.post_id
      AND p.status = 'active'
      AND (p.visibility = 'public' OR public.is_member_of(p.trip_id))
  )
);

-- 2. location_points insert: require trip membership
DROP POLICY IF EXISTS loc_self_insert ON public.location_points;
CREATE POLICY loc_self_insert ON public.location_points
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.is_member_of(trip_id));

-- 3. mission_completions insert: mission must belong to a trip the user is in
DROP POLICY IF EXISTS mc_self_insert ON public.mission_completions;
CREATE POLICY mc_self_insert ON public.mission_completions
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.missions m
    WHERE m.id = mission_completions.mission_id
      AND public.is_member_of(m.trip_id)
  )
);

-- 4. recommendations insert: require trip membership
DROP POLICY IF EXISTS rec_auth_insert ON public.recommendations;
CREATE POLICY rec_auth_insert ON public.recommendations
FOR INSERT TO authenticated
WITH CHECK (author_id = auth.uid() AND public.is_member_of(trip_id));

-- 5. reactions insert: require membership or public post
DROP POLICY IF EXISTS rx_auth_insert ON public.reactions;
CREATE POLICY rx_auth_insert ON public.reactions
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = reactions.post_id
      AND p.status = 'active'
      AND (p.visibility = 'public' OR public.is_member_of(p.trip_id))
  )
);

-- 6. user_badges: global (trip_id IS NULL) badges visible only to holder
DROP POLICY IF EXISTS ub_members_read ON public.user_badges;
CREATE POLICY ub_members_read ON public.user_badges
FOR SELECT TO authenticated
USING (
  (trip_id IS NULL AND user_id = auth.uid())
  OR (trip_id IS NOT NULL AND public.is_member_of(trip_id))
);

-- 7. destination-photos storage bucket: allow trip owners (folder-scoped via destination_photos table)
DROP POLICY IF EXISTS destphotos_owner_read ON storage.objects;
DROP POLICY IF EXISTS destphotos_owner_write ON storage.objects;

CREATE POLICY destphotos_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'destination-photos'
  AND EXISTS (
    SELECT 1 FROM public.destination_photos dp
    JOIN public.itinerary_days d ON d.id = dp.day_id
    WHERE dp.storage_path = storage.objects.name
      AND (public.is_trip_owner(d.trip_id) OR public.is_member_of(d.trip_id) OR public.is_owner())
  )
);

CREATE POLICY destphotos_public_read ON storage.objects
FOR SELECT TO anon
USING (
  bucket_id = 'destination-photos'
  AND EXISTS (
    SELECT 1 FROM public.destination_photos dp
    JOIN public.itinerary_days d ON d.id = dp.day_id
    JOIN public.trips t ON t.id = d.trip_id
    WHERE dp.storage_path = storage.objects.name
      AND t.public_slug IS NOT NULL
  )
);

CREATE POLICY destphotos_owner_write ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'destination-photos'
  AND (public.is_owner() OR auth.uid() IS NOT NULL)
);

CREATE POLICY destphotos_owner_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'destination-photos'
  AND (
    owner = auth.uid()
    OR public.is_owner()
    OR EXISTS (
      SELECT 1 FROM public.destination_photos dp
      JOIN public.itinerary_days d ON d.id = dp.day_id
      WHERE dp.storage_path = storage.objects.name
        AND public.is_trip_owner(d.trip_id)
    )
  )
);

CREATE POLICY destphotos_owner_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'destination-photos'
  AND (
    owner = auth.uid()
    OR public.is_owner()
    OR EXISTS (
      SELECT 1 FROM public.destination_photos dp
      JOIN public.itinerary_days d ON d.id = dp.day_id
      WHERE dp.storage_path = storage.objects.name
        AND public.is_trip_owner(d.trip_id)
    )
  )
);

-- destination_photos table: allow trip owners (and global owners) to write
-- (dp_owner_write already covers trip owners; no change needed)

-- 8. Lock down SECURITY DEFINER helpers from public/anon execution
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_trip_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trip_owner(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_member_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_member_of(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_active_on(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_on(uuid, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.shares_trip_with(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shares_trip_with(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.can_manage_fez(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_fez(uuid, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.sanitise_locations() FROM PUBLIC, anon, authenticated;
