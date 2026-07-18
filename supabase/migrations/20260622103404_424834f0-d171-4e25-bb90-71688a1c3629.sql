DROP POLICY IF EXISTS "profiles_trip_mates_read" ON public.profiles;
DROP POLICY IF EXISTS "profiles_trip_owner_read" ON public.profiles;

CREATE POLICY "profiles_trip_owner_read"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR public.is_owner()
  OR EXISTS (
    SELECT 1
    FROM public.trip_members tm
    JOIN public.trips t ON t.id = tm.trip_id
    WHERE tm.user_id = public.profiles.id
      AND t.owner_id = auth.uid()
  )
);