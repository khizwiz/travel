CREATE TABLE public.cost_payers (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_payers TO authenticated;
GRANT ALL ON public.cost_payers TO service_role;
ALTER TABLE public.cost_payers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read cost_payers" ON public.cost_payers
  FOR SELECT TO authenticated
  USING (public.is_member_of(trip_id));
CREATE POLICY "owner writes cost_payers" ON public.cost_payers
  FOR ALL TO authenticated
  USING (public.is_trip_owner(trip_id))
  WITH CHECK (public.is_trip_owner(trip_id));

ALTER TABLE public.trip_costs
  ADD COLUMN payer_id uuid REFERENCES public.cost_payers(id) ON DELETE SET NULL;