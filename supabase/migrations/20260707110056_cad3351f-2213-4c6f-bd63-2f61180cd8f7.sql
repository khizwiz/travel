-- 1) Add post_id column to destination_photos
ALTER TABLE public.destination_photos
  ADD COLUMN IF NOT EXISTS post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS destination_photos_post_id_idx
  ON public.destination_photos(post_id);

-- 2) Trigger function: auto-create a public companion post for each new photo.
CREATE OR REPLACE FUNCTION public.destination_photo_ensure_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _trip_id UUID;
  _owner UUID;
  _body TEXT;
  _post_id UUID;
BEGIN
  IF NEW.post_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT d.trip_id, t.owner_id
    INTO _trip_id, _owner
  FROM public.itinerary_days d
  JOIN public.trips t ON t.id = d.trip_id
  WHERE d.id = NEW.day_id;

  IF _trip_id IS NULL OR _owner IS NULL THEN
    RETURN NEW;
  END IF;

  _body := COALESCE(NULLIF(NEW.caption, ''), 'Photo from the road');

  INSERT INTO public.posts (trip_id, day_id, author_id, body, visibility, status)
  VALUES (_trip_id, NEW.day_id, _owner, _body, 'public', 'active')
  RETURNING id INTO _post_id;

  NEW.post_id := _post_id;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.destination_photo_ensure_post() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_destination_photo_ensure_post ON public.destination_photos;
CREATE TRIGGER trg_destination_photo_ensure_post
BEFORE INSERT ON public.destination_photos
FOR EACH ROW EXECUTE FUNCTION public.destination_photo_ensure_post();

-- 3) Backfill: create a companion post for existing photos that lack one.
DO $$
DECLARE
  r RECORD;
  _trip_id UUID;
  _owner UUID;
  _post_id UUID;
  _body TEXT;
BEGIN
  FOR r IN
    SELECT id, day_id, caption FROM public.destination_photos WHERE post_id IS NULL
  LOOP
    SELECT d.trip_id, t.owner_id INTO _trip_id, _owner
    FROM public.itinerary_days d
    JOIN public.trips t ON t.id = d.trip_id
    WHERE d.id = r.day_id;

    IF _trip_id IS NULL OR _owner IS NULL THEN CONTINUE; END IF;
    _body := COALESCE(NULLIF(r.caption, ''), 'Photo from the road');

    INSERT INTO public.posts (trip_id, day_id, author_id, body, visibility, status)
    VALUES (_trip_id, r.day_id, _owner, _body, 'public', 'active')
    RETURNING id INTO _post_id;

    UPDATE public.destination_photos SET post_id = _post_id WHERE id = r.id;
  END LOOP;
END $$;