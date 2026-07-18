
-- Reactions
DROP POLICY IF EXISTS rx_read ON public.reactions;
DROP POLICY IF EXISTS rx_anon_read ON public.reactions;
DROP POLICY IF EXISTS rx_auth_read ON public.reactions;
CREATE POLICY rx_anon_read ON public.reactions FOR SELECT TO anon
USING (EXISTS (
  SELECT 1 FROM public.posts p JOIN public.trips t ON t.id = p.trip_id
  WHERE p.id = reactions.post_id AND p.visibility = 'public'::post_visibility AND t.public_slug IS NOT NULL
));
CREATE POLICY rx_auth_read ON public.reactions FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.posts p
  WHERE p.id = reactions.post_id
    AND (public.is_member_of(p.trip_id)
         OR (p.visibility = 'public'::post_visibility AND EXISTS (
           SELECT 1 FROM public.trips t WHERE t.id = p.trip_id AND t.public_slug IS NOT NULL)))
));

-- Recommendations
DROP POLICY IF EXISTS rec_read ON public.recommendations;
DROP POLICY IF EXISTS rec_anon_read ON public.recommendations;
DROP POLICY IF EXISTS rec_auth_read ON public.recommendations;
CREATE POLICY rec_anon_read ON public.recommendations FOR SELECT TO anon
USING (status = 'active'::post_status AND EXISTS (
  SELECT 1 FROM public.trips t WHERE t.id = recommendations.trip_id AND t.public_slug IS NOT NULL
));
CREATE POLICY rec_auth_read ON public.recommendations FOR SELECT TO authenticated
USING (status = 'active'::post_status AND (
  public.is_member_of(trip_id)
  OR EXISTS (SELECT 1 FROM public.trips t WHERE t.id = recommendations.trip_id AND t.public_slug IS NOT NULL)
));

-- location_points: remove hardcoded email backdoor
DROP POLICY IF EXISTS loc_members_read ON public.location_points;
CREATE POLICY loc_members_read ON public.location_points FOR SELECT TO authenticated
USING (public.is_trip_owner(trip_id) OR public.is_active_on(trip_id, (ts)::date));

-- content_reports: tighten INSERT
DROP POLICY IF EXISTS rep_insert ON public.content_reports;
CREATE POLICY rep_insert ON public.content_reports FOR INSERT TO authenticated
WITH CHECK (reporter_id = auth.uid());

-- pg_net: recreate in extensions schema
CREATE SCHEMA IF NOT EXISTS extensions;
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;

-- Revoke EXECUTE on admin/trigger/cron SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.sanitise_locations() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_default_trip() FROM PUBLIC, anon, authenticated;

-- Deny-all policies on internal tables
DROP POLICY IF EXISTS rlb_no_access ON public.rate_limit_buckets;
CREATE POLICY rlb_no_access ON public.rate_limit_buckets FOR ALL TO anon, authenticated
USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS rb_no_access ON public.role_bootstrap;
CREATE POLICY rb_no_access ON public.role_bootstrap FOR ALL TO anon, authenticated
USING (false) WITH CHECK (false);
