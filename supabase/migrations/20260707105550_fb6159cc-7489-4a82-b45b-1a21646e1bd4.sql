DROP POLICY IF EXISTS "Public can read unexpired snapshots" ON public.cost_share_snapshots;
REVOKE SELECT ON public.cost_share_snapshots FROM anon;

DROP POLICY IF EXISTS "dt_public" ON public.day_travellers;
REVOKE SELECT ON public.day_travellers FROM anon;