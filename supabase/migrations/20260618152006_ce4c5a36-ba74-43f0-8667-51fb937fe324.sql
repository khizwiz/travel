
-- =====================================================================
-- EU TRIPPING â€” full schema, RLS, helpers, owner bootstrap (v2)
-- Strategy: create all tables and base policies first; cross-table
-- policies are added at the end.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Enums
CREATE TYPE public.app_role AS ENUM ('owner','companion','passenger','public_viewer');
CREATE TYPE public.trip_member_status AS ENUM ('active','suspended','revoked');
CREATE TYPE public.post_visibility AS ENUM ('public','trip','private');
CREATE TYPE public.post_status AS ENUM ('active','hidden','removed');
CREATE TYPE public.notification_channel AS ENUM ('push','whatsapp','email','inapp');

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT, phone TEXT, avatar_url TEXT,
  is_child BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_self_read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- user_roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles_self_read" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'owner'::public.app_role)
$$;

-- role bootstrap
CREATE TABLE public.role_bootstrap (email TEXT PRIMARY KEY, role public.app_role NOT NULL);
GRANT SELECT ON public.role_bootstrap TO service_role;
ALTER TABLE public.role_bootstrap ENABLE ROW LEVEL SECURITY;
INSERT INTO public.role_bootstrap(email, role) VALUES
  ('owner@example.com', 'owner'),
  ('member1@example.com', 'companion');

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _email TEXT; _role public.app_role;
BEGIN
  _email := lower(NEW.email);
  INSERT INTO public.profiles(id, email, display_name)
  VALUES (NEW.id, _email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(_email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  SELECT role INTO _role FROM public.role_bootstrap WHERE lower(email) = _email;
  IF _role IS NOT NULL THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, _role) ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'passenger') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
-- ALL TABLES (no cross-table policies yet)
-- =====================================================================

CREATE TABLE public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, public_slug TEXT UNIQUE,
  starts_on DATE NOT NULL, ends_on DATE NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  public_tracking_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.trips TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.trips TO authenticated;
GRANT ALL ON public.trips TO service_role;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.trip_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_in_trip TEXT NOT NULL DEFAULT 'passenger',
  starts_on DATE, ends_on DATE,
  status public.trip_member_status NOT NULL DEFAULT 'active',
  revoked_at TIMESTAMPTZ,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(trip_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_members TO authenticated;
GRANT ALL ON public.trip_members TO service_role;
ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.passenger_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT,
  friendly_slug TEXT UNIQUE NOT NULL,
  token_hash TEXT NOT NULL,
  starts_on DATE, ends_on DATE,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ, accepted_user_id UUID REFERENCES auth.users(id),
  revoked_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.passenger_invitations TO authenticated;
GRANT ALL ON public.passenger_invitations TO service_role;
ALTER TABLE public.passenger_invitations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.access_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id),
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  action TEXT NOT NULL, target_type TEXT, target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.access_audit_log TO authenticated;
GRANT ALL ON public.access_audit_log TO service_role;
ALTER TABLE public.access_audit_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.itinerary_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  day_date DATE NOT NULL, title TEXT NOT NULL,
  summary_public TEXT, summary_private TEXT,
  distance_km NUMERIC, duration_min INTEGER,
  leg JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(trip_id, day_date)
);
GRANT SELECT ON public.itinerary_days TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.itinerary_days TO authenticated;
GRANT ALL ON public.itinerary_days TO service_role;
ALTER TABLE public.itinerary_days ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.day_travellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id UUID NOT NULL REFERENCES public.itinerary_days(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  child_key TEXT,
  CHECK (user_id IS NOT NULL OR child_key IS NOT NULL)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.day_travellers TO authenticated;
GRANT SELECT ON public.day_travellers TO anon;
GRANT ALL ON public.day_travellers TO service_role;
ALTER TABLE public.day_travellers ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.accommodations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id UUID NOT NULL REFERENCES public.itinerary_days(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address_private TEXT, area_public TEXT,
  lat NUMERIC, lng NUMERIC,
  check_in TIMESTAMPTZ, check_out TIMESTAMPTZ,
  booking_ref TEXT, cost NUMERIC, currency TEXT, notes TEXT,
  missing BOOLEAN NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accommodations TO authenticated;
GRANT ALL ON public.accommodations TO service_role;
ALTER TABLE public.accommodations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, provider TEXT, reference TEXT,
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ,
  cost NUMERIC, currency TEXT, notes TEXT,
  missing BOOLEAN NOT NULL DEFAULT false,
  document_id UUID
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.transport_legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id UUID NOT NULL REFERENCES public.itinerary_days(id) ON DELETE CASCADE,
  from_place TEXT NOT NULL, to_place TEXT NOT NULL,
  distance_km NUMERIC, duration_min INTEGER,
  mode TEXT NOT NULL DEFAULT 'drive', polyline TEXT
);
GRANT SELECT ON public.transport_legs TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.transport_legs TO authenticated;
GRANT ALL ON public.transport_legs TO service_role;
ALTER TABLE public.transport_legs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  day_id UUID REFERENCES public.itinerary_days(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT,
  points INTEGER NOT NULL DEFAULT 10,
  is_group BOOLEAN NOT NULL DEFAULT false, is_fez BOOLEAN NOT NULL DEFAULT false,
  visibility public.post_visibility NOT NULL DEFAULT 'trip'
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.missions TO authenticated;
GRANT SELECT ON public.missions TO anon;
GRANT ALL ON public.missions TO service_role;
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.mission_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  proof_post_id UUID,
  UNIQUE(mission_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.mission_completions TO authenticated;
GRANT ALL ON public.mission_completions TO service_role;
ALTER TABLE public.mission_completions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.individual_scores (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, trip_id)
);
GRANT SELECT ON public.individual_scores TO authenticated, anon;
GRANT INSERT, UPDATE ON public.individual_scores TO authenticated;
GRANT ALL ON public.individual_scores TO service_role;
ALTER TABLE public.individual_scores ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.group_scores (
  trip_id UUID PRIMARY KEY REFERENCES public.trips(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 0
);
GRANT SELECT ON public.group_scores TO authenticated, anon;
GRANT INSERT, UPDATE ON public.group_scores TO authenticated;
GRANT ALL ON public.group_scores TO service_role;
ALTER TABLE public.group_scores ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT, icon TEXT
);
GRANT SELECT ON public.badges TO authenticated, anon;
GRANT ALL ON public.badges TO service_role;
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "badges_read_all" ON public.badges FOR SELECT TO authenticated, anon USING (true);

CREATE TABLE public.user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  badge_id UUID NOT NULL REFERENCES public.badges(id) ON DELETE CASCADE,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, badge_id, trip_id)
);
GRANT SELECT, INSERT ON public.user_badges TO authenticated;
GRANT SELECT ON public.user_badges TO anon;
GRANT ALL ON public.user_badges TO service_role;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  day_id UUID REFERENCES public.itinerary_days(id) ON DELETE SET NULL,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  visibility public.post_visibility NOT NULL DEFAULT 'trip',
  status public.post_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT SELECT ON public.posts TO anon;
GRANT ALL ON public.posts TO service_role;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.post_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image',
  width INT, height INT,
  is_public BOOLEAN NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, DELETE ON public.post_media TO authenticated;
GRANT SELECT ON public.post_media TO anon;
GRANT ALL ON public.post_media TO service_role;
ALTER TABLE public.post_media ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  visitor_label TEXT, body TEXT NOT NULL,
  status public.post_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments TO authenticated;
GRANT SELECT, INSERT ON public.comments TO anon;
GRANT ALL ON public.comments TO service_role;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  visitor_token TEXT, emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.reactions TO authenticated;
GRANT SELECT, INSERT ON public.reactions TO anon;
GRANT ALL ON public.reactions TO service_role;
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rx_read" ON public.reactions FOR SELECT TO authenticated, anon USING (true);

CREATE TABLE public.recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id),
  visitor_label TEXT, title TEXT NOT NULL, body TEXT,
  city TEXT, country TEXT,
  status public.post_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recommendations TO authenticated;
GRANT SELECT, INSERT ON public.recommendations TO anon;
GRANT ALL ON public.recommendations TO service_role;
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec_read" ON public.recommendations FOR SELECT TO authenticated, anon USING (status='active');

CREATE TABLE public.side_quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT,
  points INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.side_quests TO authenticated;
GRANT ALL ON public.side_quests TO service_role;
ALTER TABLE public.side_quests ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL, target_id UUID NOT NULL,
  reporter_id UUID REFERENCES auth.users(id),
  visitor_token TEXT, reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.content_reports TO authenticated, anon;
GRANT ALL ON public.content_reports TO service_role;
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rep_insert" ON public.content_reports FOR INSERT TO authenticated, anon WITH CHECK (true);

CREATE TABLE public.block_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  visitor_token TEXT, reason TEXT,
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.block_list TO authenticated;
GRANT ALL ON public.block_list TO service_role;
ALTER TABLE public.block_list ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rate_limit_buckets (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INT NOT NULL DEFAULT 0
);
GRANT ALL ON public.rate_limit_buckets TO service_role;
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.location_points (
  id BIGSERIAL PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat NUMERIC NOT NULL, lng NUMERIC NOT NULL,
  accuracy_m NUMERIC, speed_kph NUMERIC,
  is_parked BOOLEAN NOT NULL DEFAULT false,
  sanitised BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX ON public.location_points (trip_id, ts);
GRANT SELECT, INSERT ON public.location_points TO authenticated;
GRANT ALL ON public.location_points TO service_role;
ALTER TABLE public.location_points ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.public_location_points (
  id BIGSERIAL PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  lat_approx NUMERIC NOT NULL, lng_approx NUMERIC NOT NULL
);
CREATE INDEX ON public.public_location_points (trip_id, ts);
GRANT SELECT ON public.public_location_points TO authenticated, anon;
GRANT ALL ON public.public_location_points TO service_role;
ALTER TABLE public.public_location_points ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.vehicle_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL, make TEXT, model TEXT, year INT, plate TEXT,
  last_service_at DATE, last_service_odometer_km INT, current_odometer_km INT
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_profiles TO authenticated;
GRANT ALL ON public.vehicle_profiles TO service_role;
ALTER TABLE public.vehicle_profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.vehicle_check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicle_profiles(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  odometer_km INT,
  tyre_pressure_ok BOOLEAN, fluids_ok BOOLEAN, lights_ok BOOLEAN,
  notes TEXT, by_user UUID REFERENCES auth.users(id)
);
GRANT SELECT, INSERT ON public.vehicle_check_ins TO authenticated;
GRANT ALL ON public.vehicle_check_ins TO service_role;
ALTER TABLE public.vehicle_check_ins ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.fuel_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicle_profiles(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  litres NUMERIC, cost NUMERIC, currency TEXT,
  odometer_km INT, station TEXT, by_user UUID REFERENCES auth.users(id)
);
GRANT SELECT, INSERT ON public.fuel_logs TO authenticated;
GRANT ALL ON public.fuel_logs TO service_role;
ALTER TABLE public.fuel_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.maintenance_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicle_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL, due_km INT, due_at DATE,
  done BOOLEAN NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE ON public.maintenance_items TO authenticated;
GRANT ALL ON public.maintenance_items TO service_role;
ALTER TABLE public.maintenance_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.maintenance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicle_profiles(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  title TEXT NOT NULL, cost NUMERIC, odometer_km INT, notes TEXT
);
GRANT SELECT, INSERT ON public.maintenance_logs TO authenticated;
GRANT ALL ON public.maintenance_logs TO service_role;
ALTER TABLE public.maintenance_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.weather_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id UUID NOT NULL REFERENCES public.itinerary_days(id) ON DELETE CASCADE,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL
);
GRANT SELECT, INSERT ON public.weather_snapshots TO authenticated;
GRANT SELECT ON public.weather_snapshots TO anon;
GRANT ALL ON public.weather_snapshots TO service_role;
ALTER TABLE public.weather_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_read" ON public.weather_snapshots FOR SELECT TO authenticated, anon USING (true);

CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT, size_bytes BIGINT, expires_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL, phone TEXT NOT NULL, relation TEXT,
  visible_to_members BOOLEAN NOT NULL DEFAULT true
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emergency_contacts TO authenticated;
GRANT ALL ON public.emergency_contacts TO service_role;
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  whatsapp_number TEXT,
  quiet_hours_start TIME, quiet_hours_end TIME,
  snoozed_until TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "np_self_all" ON public.notification_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES public.trips(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
  channel public.notification_channel NOT NULL DEFAULT 'inapp',
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ, read_at TIMESTAMPTZ,
  related_type TEXT, related_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.notifications (user_id, scheduled_for);
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "n_self_read" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "n_self_update" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- =====================================================================
-- HELPER FUNCTIONS (all tables now exist)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.is_trip_owner(_trip UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.trips WHERE id=_trip AND owner_id=auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.is_member_of(_trip UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_trip_owner(_trip) OR EXISTS(
    SELECT 1 FROM public.trip_members WHERE trip_id=_trip AND user_id=auth.uid() AND status='active'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_active_on(_trip UUID, _on DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_trip_owner(_trip) OR EXISTS(
    SELECT 1 FROM public.trip_members
    WHERE trip_id=_trip AND user_id=auth.uid() AND status='active'
      AND (starts_on IS NULL OR _on >= starts_on)
      AND (ends_on   IS NULL OR _on <= ends_on)
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_fez(_trip UUID, _on DATE)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _is_simona BOOLEAN; _fez_present BOOLEAN; _simona_present BOOLEAN;
BEGIN
  IF public.is_trip_owner(_trip) THEN RETURN true; END IF;
  SELECT lower(email)='member1@example.com' INTO _is_simona FROM public.profiles WHERE id=auth.uid();
  IF NOT COALESCE(_is_simona,false) THEN RETURN false; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.day_travellers dt
    JOIN public.itinerary_days d ON d.id=dt.day_id
    WHERE d.trip_id=_trip AND d.day_date=_on AND dt.child_key='fez'
  ) INTO _fez_present;
  SELECT EXISTS(
    SELECT 1 FROM public.day_travellers dt
    JOIN public.itinerary_days d ON d.id=dt.day_id
    WHERE d.trip_id=_trip AND d.day_date=_on AND dt.user_id=auth.uid()
  ) INTO _simona_present;
  RETURN COALESCE(_fez_present,false) AND COALESCE(_simona_present,false);
END $$;

-- =====================================================================
-- POLICIES (all cross-table now safe)
-- =====================================================================

-- trips
CREATE POLICY "trips_public_read" ON public.trips FOR SELECT TO anon USING (public_slug IS NOT NULL);
CREATE POLICY "trips_members_read" ON public.trips FOR SELECT TO authenticated USING (public.is_member_of(id));
CREATE POLICY "trips_owner_write" ON public.trips FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- trip_members
CREATE POLICY "tm_self_read" ON public.trip_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_trip_owner(trip_id));
CREATE POLICY "tm_owner_write" ON public.trip_members FOR ALL TO authenticated
  USING (public.is_trip_owner(trip_id)) WITH CHECK (public.is_trip_owner(trip_id));

-- passenger_invitations (owner only)
CREATE POLICY "inv_owner" ON public.passenger_invitations FOR ALL TO authenticated
  USING (public.is_trip_owner(trip_id)) WITH CHECK (public.is_trip_owner(trip_id));

-- audit
CREATE POLICY "audit_owner_read" ON public.access_audit_log FOR SELECT TO authenticated
  USING (public.is_owner() OR (trip_id IS NOT NULL AND public.is_trip_owner(trip_id)));

-- itinerary_days
CREATE POLICY "days_public" ON public.itinerary_days FOR SELECT TO anon
  USING (EXISTS(SELECT 1 FROM public.trips t WHERE t.id=trip_id AND t.public_slug IS NOT NULL));
CREATE POLICY "days_members" ON public.itinerary_days FOR SELECT TO authenticated USING (public.is_member_of(trip_id));
CREATE POLICY "days_owner_write" ON public.itinerary_days FOR ALL TO authenticated
  USING (public.is_trip_owner(trip_id)) WITH CHECK (public.is_trip_owner(trip_id));

-- day_travellers
CREATE POLICY "dt_members" ON public.day_travellers FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.itinerary_days d WHERE d.id=day_id AND public.is_member_of(d.trip_id)));
CREATE POLICY "dt_public" ON public.day_travellers FOR SELECT TO anon
  USING (EXISTS(SELECT 1 FROM public.itinerary_days d JOIN public.trips t ON t.id=d.trip_id WHERE d.id=day_id AND t.public_slug IS NOT NULL));
CREATE POLICY "dt_owner_write" ON public.day_travellers FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.itinerary_days d WHERE d.id=day_id AND public.is_trip_owner(d.trip_id)))
  WITH CHECK (EXISTS(SELECT 1 FROM public.itinerary_days d WHERE d.id=day_id AND public.is_trip_owner(d.trip_id)));

-- accommodations (active members only)
CREATE POLICY "acc_active" ON public.accommodations FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.itinerary_days d WHERE d.id=day_id AND public.is_active_on(d.trip_id, d.day_date)));
CREATE POLICY "acc_owner_write" ON public.accommodations FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.itinerary_days d WHERE d.id=day_id AND public.is_trip_owner(d.trip_id)))
  WITH CHECK (EXISTS(SELECT 1 FROM public.itinerary_days d WHERE d.id=day_id AND public.is_trip_owner(d.trip_id)));

-- bookings
CREATE POLICY "bk_active" ON public.bookings FOR SELECT TO authenticated
  USING (public.is_trip_owner(trip_id) OR (starts_at IS NOT NULL AND public.is_active_on(trip_id, starts_at::date)));
CREATE POLICY "bk_owner_write" ON public.bookings FOR ALL TO authenticated
  USING (public.is_trip_owner(trip_id)) WITH CHECK (public.is_trip_owner(trip_id));

-- transport_legs
CREATE POLICY "leg_public" ON public.transport_legs FOR SELECT TO anon
  USING (EXISTS(SELECT 1 FROM public.itinerary_days d JOIN public.trips t ON t.id=d.trip_id WHERE d.id=day_id AND t.public_slug IS NOT NULL));
CREATE POLICY "leg_members" ON public.transport_legs FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.itinerary_days d WHERE d.id=day_id AND public.is_member_of(d.trip_id)));
CREATE POLICY "leg_owner_write" ON public.transport_legs FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.itinerary_days d WHERE d.id=day_id AND public.is_trip_owner(d.trip_id)))
  WITH CHECK (EXISTS(SELECT 1 FROM public.itinerary_days d WHERE d.id=day_id AND public.is_trip_owner(d.trip_id)));

-- missions
CREATE POLICY "missions_public" ON public.missions FOR SELECT TO anon
  USING (visibility='public' AND EXISTS(SELECT 1 FROM public.trips t WHERE t.id=trip_id AND t.public_slug IS NOT NULL));
CREATE POLICY "missions_members" ON public.missions FOR SELECT TO authenticated USING (public.is_member_of(trip_id));
CREATE POLICY "missions_owner_write" ON public.missions FOR ALL TO authenticated
  USING (public.is_trip_owner(trip_id)) WITH CHECK (public.is_trip_owner(trip_id));

-- mission_completions
CREATE POLICY "mc_members_read" ON public.mission_completions FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.missions m WHERE m.id=mission_id AND public.is_member_of(m.trip_id)));
CREATE POLICY "mc_self_insert" ON public.mission_completions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "mc_self_delete" ON public.mission_completions FOR DELETE TO authenticated USING (user_id = auth.uid());

-- individual_scores
CREATE POLICY "is_members_read" ON public.individual_scores FOR SELECT TO authenticated USING (public.is_member_of(trip_id));
CREATE POLICY "is_public_read" ON public.individual_scores FOR SELECT TO anon
  USING (EXISTS(SELECT 1 FROM public.trips t WHERE t.id=trip_id AND t.public_slug IS NOT NULL));

-- group_scores
CREATE POLICY "gs_members_read" ON public.group_scores FOR SELECT TO authenticated USING (public.is_member_of(trip_id));
CREATE POLICY "gs_public_read" ON public.group_scores FOR SELECT TO anon
  USING (EXISTS(SELECT 1 FROM public.trips t WHERE t.id=trip_id AND t.public_slug IS NOT NULL));

-- user_badges
CREATE POLICY "ub_members_read" ON public.user_badges FOR SELECT TO authenticated
  USING (trip_id IS NULL OR public.is_member_of(trip_id));
CREATE POLICY "ub_public_read" ON public.user_badges FOR SELECT TO anon
  USING (trip_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.trips t WHERE t.id=trip_id AND t.public_slug IS NOT NULL));

-- posts
CREATE POLICY "posts_public_read" ON public.posts FOR SELECT TO anon
  USING (visibility='public' AND status='active'
    AND EXISTS(SELECT 1 FROM public.trips t WHERE t.id=trip_id AND t.public_slug IS NOT NULL));
CREATE POLICY "posts_members_read" ON public.posts FOR SELECT TO authenticated
  USING (status='active' AND (visibility='public' OR public.is_member_of(trip_id)));
CREATE POLICY "posts_author_insert" ON public.posts FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.is_member_of(trip_id));
CREATE POLICY "posts_author_update" ON public.posts FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.is_trip_owner(trip_id));
CREATE POLICY "posts_author_delete" ON public.posts FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.is_trip_owner(trip_id));

-- post_media
CREATE POLICY "pm_read" ON public.post_media FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.posts p WHERE p.id=post_id AND (p.author_id=auth.uid() OR public.is_member_of(p.trip_id))));
CREATE POLICY "pm_public_read" ON public.post_media FOR SELECT TO anon
  USING (is_public AND EXISTS(SELECT 1 FROM public.posts p JOIN public.trips t ON t.id=p.trip_id
    WHERE p.id=post_id AND p.visibility='public' AND p.status='active' AND t.public_slug IS NOT NULL));
CREATE POLICY "pm_author_insert" ON public.post_media FOR INSERT TO authenticated
  WITH CHECK (EXISTS(SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.author_id=auth.uid()));
CREATE POLICY "pm_author_delete" ON public.post_media FOR DELETE TO authenticated
  USING (EXISTS(SELECT 1 FROM public.posts p WHERE p.id=post_id AND (p.author_id=auth.uid() OR public.is_trip_owner(p.trip_id))));

-- comments
CREATE POLICY "cm_read_auth" ON public.comments FOR SELECT TO authenticated
  USING (status='active' AND EXISTS(
    SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.status='active'
      AND (p.visibility='public' OR public.is_member_of(p.trip_id))));
CREATE POLICY "cm_read_anon" ON public.comments FOR SELECT TO anon
  USING (status='active' AND EXISTS(
    SELECT 1 FROM public.posts p JOIN public.trips t ON t.id=p.trip_id
    WHERE p.id=post_id AND p.visibility='public' AND p.status='active' AND t.public_slug IS NOT NULL));
CREATE POLICY "cm_anon_insert" ON public.comments FOR INSERT TO anon
  WITH CHECK (author_id IS NULL AND EXISTS(
    SELECT 1 FROM public.posts p JOIN public.trips t ON t.id=p.trip_id
    WHERE p.id=post_id AND p.visibility='public' AND p.status='active' AND t.public_slug IS NOT NULL));
CREATE POLICY "cm_auth_insert" ON public.comments FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid());
CREATE POLICY "cm_mod_update" ON public.comments FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR EXISTS(SELECT 1 FROM public.posts p WHERE p.id=post_id AND public.is_trip_owner(p.trip_id)));
CREATE POLICY "cm_mod_delete" ON public.comments FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR EXISTS(SELECT 1 FROM public.posts p WHERE p.id=post_id AND public.is_trip_owner(p.trip_id)));

-- reactions
CREATE POLICY "rx_anon_insert" ON public.reactions FOR INSERT TO anon
  WITH CHECK (user_id IS NULL AND EXISTS(SELECT 1 FROM public.posts p JOIN public.trips t ON t.id=p.trip_id
    WHERE p.id=post_id AND p.visibility='public' AND t.public_slug IS NOT NULL));
CREATE POLICY "rx_auth_insert" ON public.reactions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "rx_self_delete" ON public.reactions FOR DELETE TO authenticated USING (user_id = auth.uid());

-- recommendations
CREATE POLICY "rec_anon_insert" ON public.recommendations FOR INSERT TO anon
  WITH CHECK (author_id IS NULL AND EXISTS(SELECT 1 FROM public.trips t WHERE t.id=trip_id AND t.public_slug IS NOT NULL));
CREATE POLICY "rec_auth_insert" ON public.recommendations FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
CREATE POLICY "rec_owner_update" ON public.recommendations FOR UPDATE TO authenticated USING (public.is_trip_owner(trip_id));

-- side_quests
CREATE POLICY "sq_members_read" ON public.side_quests FOR SELECT TO authenticated USING (public.is_member_of(trip_id));
CREATE POLICY "sq_members_insert" ON public.side_quests FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_member_of(trip_id));
CREATE POLICY "sq_owner_creator_delete" ON public.side_quests FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.is_trip_owner(trip_id));

-- content_reports
CREATE POLICY "rep_owner_read" ON public.content_reports FOR SELECT TO authenticated USING (public.is_owner());

-- block_list
CREATE POLICY "bl_owner_read" ON public.block_list FOR SELECT TO authenticated USING (public.is_owner());

-- location_points
CREATE POLICY "loc_members_read" ON public.location_points FOR SELECT TO authenticated
  USING (
    public.is_trip_owner(trip_id)
    OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND lower(p.email)='member1@example.com')
    OR public.is_active_on(trip_id, ts::date)
  );
CREATE POLICY "loc_self_insert" ON public.location_points FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- public_location_points
CREATE POLICY "ploc_public_read" ON public.public_location_points FOR SELECT TO authenticated, anon
  USING (EXISTS(SELECT 1 FROM public.trips t WHERE t.id=trip_id AND t.public_tracking_enabled AND t.public_slug IS NOT NULL));

-- vehicle
CREATE POLICY "vp_members_read" ON public.vehicle_profiles FOR SELECT TO authenticated USING (public.is_member_of(trip_id));
CREATE POLICY "vp_owner_write" ON public.vehicle_profiles FOR ALL TO authenticated
  USING (public.is_trip_owner(trip_id)) WITH CHECK (public.is_trip_owner(trip_id));

CREATE POLICY "vci_members_read" ON public.vehicle_check_ins FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.vehicle_profiles v WHERE v.id=vehicle_id AND public.is_member_of(v.trip_id)));
CREATE POLICY "vci_members_insert" ON public.vehicle_check_ins FOR INSERT TO authenticated
  WITH CHECK (EXISTS(SELECT 1 FROM public.vehicle_profiles v WHERE v.id=vehicle_id AND public.is_member_of(v.trip_id)));

CREATE POLICY "fl_members_read" ON public.fuel_logs FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.vehicle_profiles v WHERE v.id=vehicle_id AND public.is_member_of(v.trip_id)));
CREATE POLICY "fl_members_insert" ON public.fuel_logs FOR INSERT TO authenticated
  WITH CHECK (EXISTS(SELECT 1 FROM public.vehicle_profiles v WHERE v.id=vehicle_id AND public.is_member_of(v.trip_id)));

CREATE POLICY "mi_members_read" ON public.maintenance_items FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.vehicle_profiles v WHERE v.id=vehicle_id AND public.is_member_of(v.trip_id)));
CREATE POLICY "mi_owner_write" ON public.maintenance_items FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.vehicle_profiles v WHERE v.id=vehicle_id AND public.is_trip_owner(v.trip_id)))
  WITH CHECK (EXISTS(SELECT 1 FROM public.vehicle_profiles v WHERE v.id=vehicle_id AND public.is_trip_owner(v.trip_id)));

CREATE POLICY "ml_members_read" ON public.maintenance_logs FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.vehicle_profiles v WHERE v.id=vehicle_id AND public.is_member_of(v.trip_id)));
CREATE POLICY "ml_owner_insert" ON public.maintenance_logs FOR INSERT TO authenticated
  WITH CHECK (EXISTS(SELECT 1 FROM public.vehicle_profiles v WHERE v.id=vehicle_id AND public.is_trip_owner(v.trip_id)));

-- documents
CREATE POLICY "doc_self_owner_read" ON public.documents FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_trip_owner(trip_id));
CREATE POLICY "doc_self_insert" ON public.documents FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND public.is_member_of(trip_id));
CREATE POLICY "doc_self_owner_update" ON public.documents FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_trip_owner(trip_id));
CREATE POLICY "doc_self_owner_delete" ON public.documents FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.is_trip_owner(trip_id));

-- emergency_contacts
CREATE POLICY "ec_read" ON public.emergency_contacts FOR SELECT TO authenticated
  USING (public.is_trip_owner(trip_id) OR (visible_to_members AND public.is_member_of(trip_id)));
CREATE POLICY "ec_owner_write" ON public.emergency_contacts FOR ALL TO authenticated
  USING (public.is_trip_owner(trip_id)) WITH CHECK (public.is_trip_owner(trip_id));

-- notifications insert (owner can schedule for members; users can schedule for themselves)
CREATE POLICY "n_insert" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR (trip_id IS NOT NULL AND public.is_trip_owner(trip_id)));

-- =====================================================================
-- Sanitisation function for public tracking
-- =====================================================================
CREATE OR REPLACE FUNCTION public.sanitise_locations()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _count INTEGER;
BEGIN
  WITH eligible AS (
    SELECT lp.id, lp.trip_id, lp.ts,
           round(lp.lat::numeric, 2) AS lat_a,
           round(lp.lng::numeric, 2) AS lng_a
    FROM public.location_points lp
    WHERE lp.sanitised = false
      AND lp.ts < now() - interval '15 minutes'
      AND lp.is_parked = false
      AND NOT EXISTS (
        SELECT 1 FROM public.accommodations a
        JOIN public.itinerary_days d ON d.id = a.day_id
        WHERE d.trip_id = lp.trip_id
          AND a.lat IS NOT NULL AND a.lng IS NOT NULL
          AND abs(a.lat - lp.lat) < 0.0045
          AND abs(a.lng - lp.lng) < 0.0065
      )
  ), ins AS (
    INSERT INTO public.public_location_points(trip_id, ts, lat_approx, lng_approx)
    SELECT trip_id, ts, lat_a, lng_a FROM eligible
    RETURNING 1
  )
  UPDATE public.location_points SET sanitised = true
  WHERE id IN (SELECT id FROM eligible);
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;

-- =====================================================================
-- Default trip bootstrap when Khizar signs in
-- =====================================================================
CREATE OR REPLACE FUNCTION public.ensure_default_trip()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF lower(NEW.email) = 'owner@example.com' THEN
    INSERT INTO public.trips (name, slug, public_slug, starts_on, ends_on, owner_id, public_tracking_enabled)
    VALUES ('EU Tripping â€” Istanbul and back', 'eu-tripping-2026', 'eu-tripping',
            '2026-07-01'::date, '2026-08-31'::date, NEW.id, true)
    ON CONFLICT (slug) DO UPDATE SET owner_id = EXCLUDED.owner_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_owner_signup AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.ensure_default_trip();

-- updated_at touch on profiles
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
