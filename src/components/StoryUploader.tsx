import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { createDestinationPhoto, listOwnerTripDays } from "@/lib/photos.functions";
import { ensureTripScaffold } from "@/lib/scaffold.functions";
import { formatDate } from "@/lib/trip-data";
import { useApp } from "@/lib/app-state";

type Day = { id: string; day_date: string; title: string | null };

/**
 * Admin-only inline uploader on the Story page. Picks a day, uploads a file
 * to the `destination-photos` bucket, then inserts a `destination_photos`
 * row so the public Story feed picks it up (a companion post row is created
 * by the database trigger).
 */
export function StoryUploader() {
  const listDays = useServerFn(listOwnerTripDays);
  const createPhoto = useServerFn(createDestinationPhoto);
  const ensureScaffold = useServerFn(ensureTripScaffold);
  const { liveFix } = useApp();
  const qc = useQueryClient();

  const [days, setDays] = useState<Day[]>([]);
  const [dayId, setDayId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    const pickDefault = (rows: any[]) => {
      setDays(rows);
      if (rows.length && !dayId) {
        const today = new Date().toISOString().slice(0, 10);
        const active =
          rows.find((r) => r.day_date === today) ??
          rows.filter((r) => r.day_date <= today).slice(-1)[0] ??
          rows[0];
        setDayId(active.id);
      }
    };
    listDays()
      .then(async (rows: any[]) => {
        if (rows.length === 0) {
          // Fresh database: create the trip, days, and photo bucket, then retry.
          try {
            await ensureScaffold();
            pickDefault(await listDays());
            return;
          } catch { /* not the owner or scaffold failed — leave empty */ }
        }
        pickDefault(rows);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload() {
    if (!file || !dayId) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${dayId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("destination-photos")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) throw upErr;
      await createPhoto({
        data: {
          dayId,
          storagePath: path,
          caption: caption.trim() || null,
          isCover: false,
          // Pin the photo to the map at the spot it was posted from.
          lat: liveFix?.lat ?? null,
          lng: liveFix?.lng ?? null,
        },
      });
      setFile(null);
      setCaption("");
      setOk("Posted to Story.");
      qc.invalidateQueries({ queryKey: ["public-story-photos"] });
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-elev p-4">
      <header className="flex items-center gap-2">
        <Camera className="h-5 w-5 text-primary" />
        <h2 className="text-sm font-semibold">Post a photo to the Story</h2>
      </header>
      <p className="mt-1 text-xs text-muted-foreground">
        Uploads to today's day by default. Anyone visiting the site will see it in the public feed.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Day
          </span>
          <select
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={dayId}
            onChange={(e) => setDayId(e.target.value)}
          >
            {days.length === 0 && <option value="">No days yet</option>}
            {days.map((d) => (
              <option key={d.id} value={d.id}>
                {formatDate(d.day_date)} — {d.title ?? "Untitled"}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Photo
          </span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Caption (optional)
        </span>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={300}
          rows={2}
          placeholder="A line about the moment…"
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </label>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={upload}
          disabled={!file || !dayId || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Post to Story
        </button>
        {ok && <span className="text-xs text-primary">{ok}</span>}
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </section>
  );
}
