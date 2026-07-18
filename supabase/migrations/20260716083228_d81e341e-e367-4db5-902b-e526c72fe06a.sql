
CREATE TABLE public.translations (
  source_hash TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  source TEXT NOT NULL,
  translated TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_hash, target_lang)
);

GRANT SELECT ON public.translations TO anon, authenticated;
GRANT ALL ON public.translations TO service_role;

ALTER TABLE public.translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read translations"
  ON public.translations
  FOR SELECT
  USING (true);
