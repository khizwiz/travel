import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Plane, Ship, BedDouble, Upload, Sparkles, Check, X, Loader2 } from "lucide-react";

import { formatDate, formatDuration, ITINERARY } from "@/lib/trip-data";
import { useApp } from "@/lib/app-state";
import { useAuth } from "@/lib/auth";
import {
  extractBooking,
  listBookingUploads,
  decideBookingUpload,
} from "@/lib/bookings.functions";
import { listPublicAccommodations } from "@/lib/planning.functions";
import { OwnerOnly } from "@/components/OwnerOnly";

export const Route = createFileRoute("/bookings")({
  head: () => ({ meta: [{ title: "Bookings — Tripping" }] }),
  component: BookingsGate,
});

function BookingsGate() {
  return (
    <OwnerOnly page="Bookings">
      <BookingsPage />
    </OwnerOnly>
  );
}

function BookingsPage() {
  const { isOwner } = useApp();
  const { isOwner: isOwnerAuth } = useAuth();
  const showUpload = isOwner || isOwnerAuth;
  const flights = ITINERARY.filter((d) => d.flight);
  const ferries = ITINERARY.filter((d) => d.ferry);
  const staticStays = ITINERARY.filter((d) => d.accommodation);

  const fetchAccoms = useServerFn(listPublicAccommodations);
  const { data: savedAccoms } = useQuery({
    queryKey: ["public-accommodations"],
    queryFn: () => fetchAccoms(),
    staleTime: 30_000,
  });
  const savedDates = new Set((savedAccoms ?? []).map((a: any) => a.day_date).filter(Boolean));
  const staticFallback = staticStays.filter((d) => !savedDates.has(d.date));


  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl">Bookings</h1>
        <p className="text-sm text-muted-foreground">Flights, ferries and accommodation.</p>
      </header>

      {showUpload ? <UploadCentre /> : null}



      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Plane className="h-4 w-4" /> Flights
        </h2>
        {flights.map((d) => (
          <div key={d.id} className="card-elev p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-medium">
                {d.flight!.airline} {d.flight!.number}
              </div>
              <div className="text-xs text-muted-foreground">{formatDate(d.date)}</div>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {d.flight!.from} {d.flight!.departLocal} → {d.flight!.to} {d.flight!.arriveLocal} ·{" "}
              {formatDuration(d.flight!.durationMin)}
            </div>
            <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {d.flight!.reservation ? <div>Reservation: {d.flight!.reservation}</div> : null}
              {d.flight!.bookingRef ? <div>Booking: {d.flight!.bookingRef}</div> : null}
              {d.flight!.seats ? (
                <div>
                  Seats:{" "}
                  {Object.entries(d.flight!.seats)
                    .map(([n, s]) => `${n} ${s}`)
                    .join(" · ")}
                </div>
              ) : null}
              {d.flight!.baggageNote ? (
                <div className="sm:col-span-2">Baggage: {d.flight!.baggageNote}</div>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Travellers: {d.travellers.join(", ")}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Ship className="h-4 w-4" /> Ferries
        </h2>
        {ferries.map((d) => (
          <div key={d.id} className="card-elev p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-medium">
                {d.ferry!.from} → {d.ferry!.to}
              </div>
              <div className="text-xs text-muted-foreground">{formatDate(d.date)}</div>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {d.ferry!.departLocal ?? "Departure TBC"} · sailing{" "}
              {formatDuration(d.ferry!.durationMin)}
            </div>
            {d.ferry!.note ? (
              <div className="mt-2 text-xs text-warning">{d.ferry!.note}</div>
            ) : null}
            {!d.ferry!.operator || !d.ferry!.bookingRef ? (
              <div className="mt-3 text-xs text-muted-foreground">
                Operator and booking reference will appear here once added in the Upload Centre.
              </div>
            ) : null}
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <BedDouble className="h-4 w-4" /> Accommodation
        </h2>
        {(savedAccoms ?? []).map((a: any) => (
          <div key={a.id} className="card-elev p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-medium">{a.name}</div>
              <div className="text-xs text-muted-foreground">
                {a.check_in ? formatDate(a.check_in) : a.day_date ? formatDate(a.day_date) : ""}
                {a.check_out ? ` → ${formatDate(a.check_out)}` : ""}
              </div>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {a.area_public ?? "Area TBC"}
              {a.booking_ref ? ` · Ref ${a.booking_ref}` : ""}
              {/* Cost intentionally hidden — accessible only via the AI assistant. */}
            </div>
          </div>
        ))}
        {staticFallback.map((d) => (
          <div key={d.id} className="card-elev p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-medium">{d.accommodation!.name}</div>
              <div className="text-xs text-muted-foreground">{formatDate(d.date)}</div>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {isOwner && d.accommodation!.addressPrivate
                ? d.accommodation!.addressPrivate
                : d.accommodation!.addressPublic ?? "Address private"}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function UploadCentre() {
  const extract = useServerFn(extractBooking);
  const list = useServerFn(listBookingUploads);
  const decide = useServerFn(decideBookingUpload);

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = async () => {
    try {
      const res = await list({ data: { status: "pending" } });
      setPending(res.rows ?? []);
      setLoaded(true);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load");
    }
  };

  if (!loaded) {
    refresh();
  }

  const fileToDataUrl = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });

  const submit = async () => {
    setErr(null);
    if (!text.trim() && !file) {
      setErr("Paste text or attach an image of the booking.");
      return;
    }
    setBusy(true);
    try {
      const payload: any = {};
      if (text.trim()) payload.text = text.trim();
      if (file) {
        payload.imageDataUrl = await fileToDataUrl(file);
        payload.filename = file.name;
      }
      await extract({ data: payload });
      setText("");
      setFile(null);
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Extraction failed");
    } finally {
      setBusy(false);
    }
  };

  const onDecide = async (id: string, decision: "approved" | "rejected") => {
    try {
      await decide({ data: { id, decision } });
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Action failed");
    }
  };

  return (
    <section className="card-elev p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Upload Centre — AI extraction
        </h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Paste a confirmation email or attach a screenshot/PDF page. AI extracts the booking
        details; nothing is applied until you approve.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste booking confirmation text…"
        rows={4}
        className="w-full rounded-lg border border-border bg-background p-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted">
          <Upload className="h-4 w-4" />
          {file ? file.name : "Attach image / PDF page"}
          <input
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Extract with AI
        </button>
      </div>
      {err ? <p className="text-xs text-destructive">{err}</p> : null}

      {pending.length > 0 ? (
        <div className="mt-2 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Pending approvals</div>
          {pending.map((row) => (
            <div key={row.id} className="rounded-lg border border-border bg-background/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {row.parsed_json?.title ?? "Untitled booking"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.parsed_json?.type ?? "—"} ·{" "}
                    {row.parsed_json?.location ?? "Location unknown"}
                  </div>
                  {row.parsed_json?.check_in ? (
                    <div className="text-xs text-muted-foreground">
                      {row.parsed_json.check_in}
                      {row.parsed_json.check_out ? ` → ${row.parsed_json.check_out}` : ""}
                    </div>
                  ) : null}
                  {row.parsed_json?.confirmation ? (
                    <div className="text-xs text-muted-foreground">
                      Conf: {row.parsed_json.confirmation}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => onDecide(row.id, "approved")}
                    className="rounded-md bg-success/20 p-1.5 text-success hover:bg-success/30"
                    aria-label="Approve"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onDecide(row.id, "rejected")}
                    className="rounded-md bg-destructive/20 p-1.5 text-destructive hover:bg-destructive/30"
                    aria-label="Reject"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

