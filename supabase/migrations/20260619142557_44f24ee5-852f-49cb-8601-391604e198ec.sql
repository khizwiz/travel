-- 1. weather_snapshots: restrict reads to trip members / public trip viewers
DROP POLICY IF EXISTS "ws_read" ON public.weather_snapshots;

CREATE POLICY "ws_read_member" ON public.weather_snapshots
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.itinerary_days d
    WHERE d.id = weather_snapshots.day_id
      AND public.is_member_of(d.trip_id)
  ));

CREATE POLICY "ws_read_public" ON public.weather_snapshots
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.itinerary_days d
    JOIN public.trips t ON t.id = d.trip_id
    WHERE d.id = weather_snapshots.day_id
      AND t.public_slug IS NOT NULL
  ));

-- 2. destination-photos storage bucket: drop broad read, restrict to owner
DROP POLICY IF EXISTS "destphotos_auth_read" ON storage.objects;

CREATE POLICY "destphotos_owner_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'destination-photos' AND public.is_owner());

-- 3. passenger_invitations: let the accepted invitee read their own row
CREATE POLICY "inv_invitee_read" ON public.passenger_invitations
  FOR SELECT TO authenticated
  USING (accepted_user_id = auth.uid());

-- 4. profiles: helper + policy so trip co-members can read each other's profile
CREATE OR REPLACE FUNCTION public.shares_trip_with(_other uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trip_members me
    JOIN public.trip_members them ON them.trip_id = me.trip_id
    WHERE me.user_id = auth.uid() AND me.status = 'active'
      AND them.user_id = _other AND them.status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.owner_id = auth.uid()
      AND (
        EXISTS (SELECT 1 FROM public.trip_members m
                WHERE m.trip_id = t.id AND m.user_id = _other AND m.status = 'active')
        OR t.owner_id = _other
      )
  ) OR EXISTS (
    SELECT 1 FROM public.trips t
    JOIN public.trip_members m ON m.trip_id = t.id
    WHERE m.user_id = auth.uid() AND m.status = 'active'
      AND t.owner_id = _other
  );
$$;

CREATE POLICY "profiles_trip_mates_read" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.shares_trip_with(id));