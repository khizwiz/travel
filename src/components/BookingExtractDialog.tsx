import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles, Upload, X } from "lucide-react";
import { extractAccommodation } from "@/lib/booking-extract.functions";

export interface ExtractedAccommodation {
  hotelName?: string;
  city?: string;
  area?: string;
  address?: string;
  checkIn?: string;
  checkOut?: string;
  bookingRef?: string;
  priceTotal?: number;
  currency?: string;
  notes?: string;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

export function BookingExtractDialog({
  onClose,
  onApply,
}: {
  onClose: () => void;
  onApply: (data: ExtractedAccommodation) => void;
}) {
  const extract = useServerFn(extractAccommodation);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedAccommodation | null>(null);

  async function run() {
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      if (file.size > 6 * 1024 * 1024) {
        throw new Error("File is over 6 MB — pick a smaller PDF or image.");
      }
      const dataUrl = await fileToDataUrl(file);
      const r = await extract({ data: { fileDataUrl: dataUrl, filename: file.name } });
      setResult(r.parsed as ExtractedAccommodation);
    } catch (e: any) {
      setErr(e?.message ?? "Extraction failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card-elev w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl">Import booking</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Drop a PDF, screenshot, or forwarded email. AI fills the hotel form — you confirm.
        </p>

        {!result ? (
          <>
            <label className="mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm hover:bg-muted/50">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="font-medium">
                {file ? file.name : "Choose PDF, image, or .eml/.html"}
              </span>
              <span className="text-xs text-muted-foreground">Max 6 MB</span>
              <input
                type="file"
                accept="application/pdf,image/*,text/plain,text/html,message/rfc822,.eml"
                className="hidden"
                onChange={(e) => {
                  setErr(null);
                  setFile(e.target.files?.[0] ?? null);
                }}
              />
            </label>
            {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
            <button
              onClick={run}
              disabled={!file || busy}
              className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Extract with AI
            </button>
          </>
        ) : (
          <>
            <div className="mt-4 space-y-1.5 rounded-lg border border-border bg-muted/20 p-3 text-sm">
              <PreviewRow label="Hotel" value={result.hotelName} />
              <PreviewRow label="City" value={result.city} />
              <PreviewRow label="Area" value={result.area} />
              <PreviewRow label="Address" value={result.address} />
              <PreviewRow label="Check-in" value={result.checkIn} />
              <PreviewRow label="Check-out" value={result.checkOut} />
              <PreviewRow label="Ref" value={result.bookingRef} />
              <PreviewRow
                label="Price"
                value={
                  result.priceTotal != null
                    ? `${result.priceTotal} ${result.currency ?? ""}`
                    : undefined
                }
              />
              {result.notes && (
                <PreviewRow label="Notes" value={result.notes} multiline />
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  setResult(null);
                  setFile(null);
                }}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                Try another
              </button>
              <button
                onClick={() => onApply(result)}
                className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              >
                Use these fields
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value?: string | number;
  multiline?: boolean;
}) {
  if (value == null || value === "") return null;
  return (
    <div className={`grid grid-cols-[5rem_1fr] gap-2 ${multiline ? "items-start" : "items-baseline"}`}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={multiline ? "whitespace-pre-wrap" : "truncate"}>{String(value)}</span>
    </div>
  );
}
