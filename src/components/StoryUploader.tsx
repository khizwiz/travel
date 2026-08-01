import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Compass, ImagePlus, Loader2, MapPin, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  createDestinationPhoto,
  listOwnerTripDays,
  repinDestinationPhotos,
} from "@/lib/photos.functions";
import { ensureTripScaffold } from "@/lib/scaffold.functions";
import { prepareImageForUpload } from "@/lib/image-prep";
import { readExifGps } from "@/lib/exif-gps";
import { removeSamplePhotos, seedSamplePhotos } from "@/lib/seed-photos.functions";
import { backfillPhotoGeo } from "@/lib/photo-geo.functions";
import { formatDate, ITINERARY } from "@/lib/trip-data";
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
  const addSamples = useServerFn(seedSamplePhotos);
  const dropSamples = useServerFn(removeSamplePhotos);
  const repin = useServerFn(repinDestinationPhotos);
  const backfill = useServerFn(backfillPhotoGeo);
  const { liveFix } = useApp();
  const qc = useQueryClient();

  const [days, setDays] = useState<Day[]>([]);
  const [dayId, setDayId] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [sampling, setSampling] = useState<"add" | "remove" | "repin" | "geo" | null>(null);
  const [sampleMsg, setSampleMsg] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /**
   * Reading locations opens each stored photo, so the server works in batches
   * and says what is left. Keep going until it is done, showing progress —
   * otherwise a large feed would need the button pressed a dozen times.
   */
  async function runGeoBackfill() {
    let located = 0;
    let fromDay = 0;
    let scanned = 0;
    for (let pass = 0; pass < 40; pass++) {
      // The cursor is the caller's job: a full re-read leaves no "done" mark
      // on a row, so without it every pass would re-open the same photos.
      const r = await backfill({ data: { offset: scanned } });
      scanned += r.scanned;
      located += r.located;
      fromDay += r.fellBackToDay;
      setSampleMsg(
        r.remaining
          ? `Read ${scanned} photo${scanned === 1 ? "" : "s"}… ${r.remaining} to go.`
          : `Done: ${located} placed from the photo's own data` +
            (fromDay ? `, ${fromDay} from their day` : "") +
            (scanned === 0 ? " — nothing needed reading." : "."),
      );
      if (!r.remaining || r.scanned === 0) break;
    }
  }

  async function runSamples(which: "add" | "remove" | "repin" | "geo") {
    setSampling(which);
    setSampleMsg(null);
    try {
      if (which === "geo") {
        await runGeoBackfill();
        qc.invalidateQueries({ queryKey: ["public-story-photos"] });
        setSampling(null);
        return;
      }
      const r =
        which === "add"
          ? await addSamples({ data: {} })
          : which === "remove"
            ? await dropSamples({ data: {} })
            : await repin({ data: {} });
      setSampleMsg(r.message);
      qc.invalidateQueries({ queryKey: ["public-story-photos"] });
    } catch (e: any) {
      const reason = e?.message ?? "Failed";
      setSampleMsg(
        /row-level security|jwt|not authorized|expired/i.test(reason)
          ? "Your sign-in has expired — sign in again and retry."
          : reason,
      );
    } finally {
      setSampling(null);
    }
  }

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
        // Fill in whatever the database is missing, not just a database that is
        // entirely empty.
        //
        // This used to run only when there were zero days. A single booking
        // import creates a day, so the count was never zero again and the other
        // forty were never written — leaving three dates in this picker, no
        // story history, and nothing for photos to attach to. The scaffold only
        // ever inserts dates it does not already have, so running it whenever
        // the plan is short of days is safe and idempotent.
        if (rows.length < ITINERARY.length) {
          try {
            await ensureScaffold();
            const filled = await listDays();
            if (filled.length > rows.length) {
              setNote(`Added ${filled.length - rows.length} missing days from the plan.`);
            }
            pickDefault(filled);
            return;
          } catch { /* not the owner or scaffold failed — use what we have */ }
        }
        pickDefault(rows);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload() {
    if (files.length === 0 || !dayId) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    let posted = 0;
    const remaining = [...files];
    let heicWarning = false;
    try {
      while (remaining.length) {
        const original = remaining[0];
        // Read where the photo was taken BEFORE touching it — converting HEIC
        // to JPEG re-encodes through a canvas, which drops every EXIF tag.
        const exif = await readExifGps(original);
        // iPhone HEIC becomes JPEG here, and huge photos are scaled down, so
        // the post is visible to everyone and the upload survives a roadside
        // connection. See image-prep.ts for why this is not optional.
        const prepared = await prepareImageForUpload(original);
        if (prepared.undecodableHeic) heicWarning = true;

        const ext = prepared.file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${dayId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("destination-photos")
          .upload(path, prepared.file, {
            cacheControl: "3600",
            upsert: false,
            contentType: prepared.file.type || undefined,
          });
        if (upErr) throw upErr;
        await createPhoto({
          data: {
            dayId,
            storagePath: path,
            // The caption goes on the first photo of the batch.
            caption: posted === 0 ? caption.trim() || null : null,
            isCover: false,
            // Where the camera says the photo was taken, when it says so.
            exifLat: exif?.lat ?? null,
            exifLng: exif?.lng ?? null,
            // The phone's position now — only meaningful for today's photos.
            lat: liveFix?.lat ?? null,
            lng: liveFix?.lng ?? null,
          },
        });
        posted += 1;
        // Drop it only once it is safely posted, so a failure part-way through
        // leaves exactly the un-posted photos selected and retrying cannot
        // upload the same photo twice.
        remaining.shift();
      }
      setFiles([]);
      setCaption("");
      setOk(
        (posted === 1 ? "Posted to Story." : `Posted ${posted} photos to Story.`) +
          (heicWarning
            ? " One was an iPhone photo this browser cannot convert — it may not display for everyone."
            : ""),
      );
      qc.invalidateQueries({ queryKey: ["public-story-photos"] });
    } catch (e: any) {
      // Keep the un-posted photos selected so the button retries just those.
      setFiles(remaining);
      if (posted > 0) {
        setCaption("");
        qc.invalidateQueries({ queryKey: ["public-story-photos"] });
      }
      const reason = e?.message ?? "Upload failed";
      const rls = /row-level security|violates|jwt|not authorized/i.test(reason);
      setErr(
        (posted > 0 ? `Posted ${posted}, then failed: ` : "") +
          (rls ? "your sign-in has expired — sign in again and retry" : reason),
      );
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
      {note && <p className="mt-1 text-xs text-primary">{note}</p>}

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
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
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
          disabled={files.length === 0 || !dayId || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {files.length > 1 ? `Post ${files.length} photos` : "Post to Story"}
        </button>
        {ok && <span className="text-xs text-primary">{ok}</span>}
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>

      {/* Sample photos: a way to confirm the whole path works — bucket, row,
          companion post, signed URL, feed, map pin — without waiting to be
          somewhere photogenic. Clearly labelled and removable in one tap. */}
      <div className="mt-4 border-t border-border/60 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => runSamples("add")}
            disabled={sampling !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {sampling === "add" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImagePlus className="h-3.5 w-3.5" />
            )}
            Add sample photos
          </button>
          <button
            onClick={() => runSamples("remove")}
            disabled={sampling !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {sampling === "remove" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Remove samples
          </button>
          <button
            onClick={() => runSamples("geo")}
            disabled={sampling !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {sampling === "geo" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Compass className="h-3.5 w-3.5" />
            )}
            Read photo locations
          </button>
          <button
            onClick={() => runSamples("repin")}
            disabled={sampling !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {sampling === "repin" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MapPin className="h-3.5 w-3.5" />
            )}
            Re-pin photos to their day
          </button>
          {sampleMsg && <span className="text-xs text-muted-foreground">{sampleMsg}</span>}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Samples are drawn by the app, not photographs. Re-pinning moves photos
          uploaded earlier onto the map at the place their day was, rather than
          where the phone was when you posted them.
        </p>
      </div>
    </section>
  );
}
