-- Option A: Splitwise-style costs.
-- Every active trip member can add costs, choose the split, and see all
-- expenses, splits, and balances. Owner keeps moderation rights.
-- IMPORTANT: run this on the Supabase project (SQL editor or `supabase db push`)
-- BEFORE deploying the code changes in this branch.

-- ============ trip_costs ============
DROP POLICY IF EXISTS tc_companion_insert   ON public.trip_costs;
DROP POLICY IF EXISTS tc_companion_read_own ON public.trip_costs;

CREATE POLICY tc_member_read ON public.trip_costs
  FOR SELECT TO authenticated
  USING (public.is_member_of(trip_id));

CREATE POLICY tc_member_insert ON public.trip_costs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of(trip_id) AND created_by = auth.uid());

CREATE POLICY tc_member_update_own ON public.trip_costs
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY tc_member_delete_own ON public.trip_costs
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());
-- (tc_owner_all remains: owner can still edit/approve/delete anything.)

-- ============ trip_cost_splits ============
DROP POLICY IF EXISTS tcs_self_read ON public.trip_cost_splits;

CREATE POLICY tcs_member_read ON public.trip_cost_splits
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.trip_costs c
                 WHERE c.id = cost_id AND public.is_member_of(c.trip_id)));

CREATE POLICY tcs_creator_write ON public.trip_cost_splits
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.trip_costs c
                 WHERE c.id = cost_id AND c.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.trip_costs c
                      WHERE c.id = cost_id AND c.created_by = auth.uid()));
-- (tcs_owner_all remains.)

-- ============ cost_payers ============
DROP POLICY IF EXISTS "owner writes cost_payers" ON public.cost_payers;

CREATE POLICY "members add cost_payers" ON public.cost_payers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of(trip_id));

CREATE POLICY "owner manages cost_payers" ON public.cost_payers
  FOR ALL TO authenticated
  USING (public.is_trip_owner(trip_id))
  WITH CHECK (public.is_trip_owner(trip_id));

-- ============ Data repair ============
-- 1) Promote member submissions stuck in the old approval queue.
UPDATE public.trip_costs
SET status = 'approved', approved_at = now()
WHERE status = 'pending';

-- 2) Backfill equal splits for approved costs that have none,
--    among that day's travellers (excluding the child key 'fez'),
--    mirroring materialiseSplitsUnified's default behaviour.
INSERT INTO public.trip_cost_splits
  (cost_id, participant_user_id, participant_key, share_eur)
SELECT c.id, dt.user_id, dt.child_key,
       round(c.amount_eur / cnt.n, 2)
FROM public.trip_costs c
JOIN public.itinerary_days d
  ON d.trip_id = c.trip_id AND d.day_date = c.day_date
JOIN public.day_travellers dt
  ON dt.day_id = d.id AND (dt.child_key IS DISTINCT FROM 'fez')
JOIN LATERAL (
  SELECT count(*) AS n FROM public.day_travellers dt2
  WHERE dt2.day_id = d.id AND (dt2.child_key IS DISTINCT FROM 'fez')
) cnt ON true
WHERE c.status = 'approved'
  AND NOT EXISTS (SELECT 1 FROM public.trip_cost_splits s
                  WHERE s.cost_id = c.id);
