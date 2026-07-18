
DO $$ BEGIN
  CREATE TYPE public.cost_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.day_kind AS ENUM ('destination','rest','open','empty');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.booking_upload_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.itinerary_days
  ADD COLUMN IF NOT EXISTS day_kind public.day_kind NOT NULL DEFAULT 'destination',
  ADD COLUMN IF NOT EXISTS cover_photo_path text;

CREATE TABLE IF NOT EXISTS public.trip_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  day_date date NOT NULL,
  amount_eur numeric(12,2) NOT NULL CHECK (amount_eur >= 0),
  original_amount numeric(12,2),
  original_currency text,
  paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_by_label text,
  category text NOT NULL DEFAULT 'misc',
  description text,
  receipt_path text,
  status public.cost_status NOT NULL DEFAULT 'pending',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trip_costs_trip_idx ON public.trip_costs(trip_id, day_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_costs TO authenticated;
GRANT ALL ON public.trip_costs TO service_role;
ALTER TABLE public.trip_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tc_owner_all ON public.trip_costs
  FOR ALL TO authenticated
  USING (public.is_trip_owner(trip_id))
  WITH CHECK (public.is_trip_owner(trip_id));

CREATE POLICY tc_companion_insert ON public.trip_costs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_on(trip_id, day_date)
    AND created_by = auth.uid()
    AND status = 'pending'
    AND approved_by IS NULL
  );

CREATE POLICY tc_companion_read_own ON public.trip_costs
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

CREATE TRIGGER trip_costs_touch BEFORE UPDATE ON public.trip_costs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.trip_cost_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_id uuid NOT NULL REFERENCES public.trip_costs(id) ON DELETE CASCADE,
  participant_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_key text,
  share_eur numeric(12,2) NOT NULL CHECK (share_eur >= 0),
  CHECK (participant_user_id IS NOT NULL OR participant_key IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS tcs_cost_idx ON public.trip_cost_splits(cost_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_cost_splits TO authenticated;
GRANT ALL ON public.trip_cost_splits TO service_role;
ALTER TABLE public.trip_cost_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY tcs_owner_all ON public.trip_cost_splits
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.trip_costs c WHERE c.id = cost_id AND public.is_trip_owner(c.trip_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.trip_costs c WHERE c.id = cost_id AND public.is_trip_owner(c.trip_id)));

CREATE POLICY tcs_self_read ON public.trip_cost_splits
  FOR SELECT TO authenticated
  USING (participant_user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.destination_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id uuid NOT NULL REFERENCES public.itinerary_days(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  caption text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_cover boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS destination_photos_day_idx ON public.destination_photos(day_id);
GRANT SELECT ON public.destination_photos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.destination_photos TO authenticated;
GRANT ALL ON public.destination_photos TO service_role;
ALTER TABLE public.destination_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY dp_public_read ON public.destination_photos
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.itinerary_days d
    JOIN public.trips t ON t.id = d.trip_id
    WHERE d.id = destination_photos.day_id AND t.public_slug IS NOT NULL
  ));

CREATE POLICY dp_members_read ON public.destination_photos
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.itinerary_days d WHERE d.id = day_id AND public.is_member_of(d.trip_id)));

CREATE POLICY dp_owner_write ON public.destination_photos
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.itinerary_days d WHERE d.id = day_id AND public.is_trip_owner(d.trip_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.itinerary_days d WHERE d.id = day_id AND public.is_trip_owner(d.trip_id)));

CREATE TABLE IF NOT EXISTS public.booking_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  file_path text,
  raw_text text,
  booking_type text,
  parsed_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggested_changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.booking_upload_status NOT NULL DEFAULT 'pending',
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_uploads_trip_idx ON public.booking_uploads(trip_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_uploads TO authenticated;
GRANT ALL ON public.booking_uploads TO service_role;
ALTER TABLE public.booking_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY bu_owner_all ON public.booking_uploads
  FOR ALL TO authenticated
  USING (public.is_trip_owner(trip_id))
  WITH CHECK (public.is_trip_owner(trip_id));

CREATE POLICY bu_companion_insert ON public.booking_uploads
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_member_of(trip_id)
    AND uploaded_by = auth.uid()
    AND status = 'pending'
  );

CREATE POLICY bu_companion_read_own ON public.booking_uploads
  FOR SELECT TO authenticated
  USING (uploaded_by = auth.uid());

CREATE TRIGGER booking_uploads_touch BEFORE UPDATE ON public.booking_uploads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
