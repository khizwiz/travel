CREATE TABLE public.cost_share_snapshots (
  token TEXT PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

GRANT SELECT ON public.cost_share_snapshots TO anon;
GRANT SELECT, INSERT, DELETE ON public.cost_share_snapshots TO authenticated;
GRANT ALL ON public.cost_share_snapshots TO service_role;

ALTER TABLE public.cost_share_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read unexpired snapshots"
  ON public.cost_share_snapshots FOR SELECT
  USING (expires_at > now());

CREATE POLICY "Trip owners can create snapshots"
  ON public.cost_share_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (public.is_trip_owner(trip_id) AND created_by = auth.uid());

CREATE POLICY "Trip owners can delete snapshots"
  ON public.cost_share_snapshots FOR DELETE
  TO authenticated
  USING (public.is_trip_owner(trip_id));

CREATE INDEX cost_share_snapshots_trip_idx ON public.cost_share_snapshots(trip_id);
CREATE INDEX cost_share_snapshots_expires_idx ON public.cost_share_snapshots(expires_at);