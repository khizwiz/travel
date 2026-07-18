-- Photos on the map: store where each story photo was taken.
-- Captured client-side from the device GPS at upload time (nullable — old
-- photos and uploads without location simply have no marker).
ALTER TABLE public.destination_photos
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;
