import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Route, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { applyReroute, clearReroute, suggestReroute } from "@/lib/reroute.functions";
import { cn } from "@/lib/utils";

interface Option {
  to: string;
  transport: string;
  distanceKm: number;
  durationMin: number;
  why: string;
}

interface Props {
  dayDate: string;
  currentFrom: string;
  originalTo?: string | null;
  nextFixedStop?: string | null;
  hasOverride?: boolean;
  trigger?: React.ReactNode;
  compact?: boolean;
}

export function RePlanSheet({
  dayDate,
  currentFrom,
  originalTo,
  nextFixedStop,
  hasOverride,
  trigger,
  compact,
}: Props) {
  const [open, setOpen] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [options, setOptions] = useState<Option[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const qc = useQueryClient();

  const suggest = useServerFn(suggestReroute);
  const apply = useServerFn(applyReroute);
  const clear = useServerFn(clearReroute);

  const suggestMutation = useMutation({
    mutationFn: () =>
      suggest({
        data: {
          dayDate,
          currentFrom,
          originalTo: originalTo ?? undefined,
          nextFixedStop: nextFixedStop ?? undefined,
          freeText: freeText.trim() || undefined,
        },
      }),
    onSuccess: (r: any) => {
      if (r?.error) {
        toast.error(r.error);
        return;
      }
      setOptions(r?.options ?? []);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to fetch suggestions"),
  });

  async function pick(opt: Option) {
    setSaving(opt.to);
    try {
      const r: any = await apply({
        data: {
          dayDate,
          from: currentFrom,
          to: opt.to,
          transport: (opt.transport as any) || "drive",
          distanceKm: Number.isFinite(opt.distanceKm) ? opt.distanceKm : null,
          durationMin: Number.isFinite(opt.durationMin) ? Math.round(opt.durationMin) : null,
          notes: opt.why,
        },
      });
      if (r?.ok) {
        toast.success(`Locked in: ${opt.to}`);
        qc.invalidateQueries({ queryKey: ["plan-overrides"] });
        setOpen(false);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(null);
    }
  }

  async function reset() {
    try {
      await clear({ data: { dayDate } });
      toast.success("Reverted to original plan");
      qc.invalidateQueries({ queryKey: ["plan-overrides"] });
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to reset");
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary transition hover:bg-primary/20",
              compact && "px-2 py-0.5 text-[11px]",
            )}
          >
            <Wand2 className="h-3.5 w-3.5" /> Change plan
          </button>
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-display text-xl">
            <Route className="h-5 w-5 text-primary" /> Change today's plan
          </SheetTitle>
          <SheetDescription>
            {currentFrom}
            {originalTo && originalTo !== currentFrom ? ` → originally ${originalTo}` : ""} · {dayDate}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Where are you headed?
            </label>
            <Textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="e.g. tired, want to stop before Ancona / push on to Bologna / rest day here"
              className="mt-1.5 min-h-[70px]"
            />
            <Button
              onClick={() => suggestMutation.mutate()}
              disabled={suggestMutation.isPending}
              className="mt-2 w-full"
            >
              {suggestMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Thinking…</>
              ) : (
                <><Sparkles className="mr-2 h-4 w-4" /> Get suggestions</>
              )}
            </Button>
          </div>

          {options && options.length === 0 && (
            <p className="text-sm text-muted-foreground">No suggestions returned — try adding more detail.</p>
          )}

          {options && options.length > 0 && (
            <ul className="space-y-2">
              {options.map((o, i) => (
                <li key={`${o.to}-${i}`} className="card-elev p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-display text-base">{o.to}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {o.transport}
                        {o.distanceKm ? ` · ${Math.round(o.distanceKm)} km` : ""}
                        {o.durationMin ? ` · ${Math.round(o.durationMin / 60)}h ${o.durationMin % 60}m` : ""}
                      </div>
                      {o.why && <p className="mt-1 text-xs">{o.why}</p>}
                    </div>
                    <Button
                      size="sm"
                      disabled={saving !== null}
                      onClick={() => pick(o)}
                    >
                      {saving === o.to ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lock in"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {hasOverride && (
            <Button variant="ghost" onClick={reset} className="w-full text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> Revert to original plan
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
