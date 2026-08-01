import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPublicPlanOverrides } from "@/lib/reroute.functions";
import { ITINERARY } from "@/lib/trip-data";

export interface PlanOverride {
  day_date: string;
  title: string | null;
  summary: string | null;
  distance_km: number | null;
  duration_min: number | null;
  from: string | null;
  to: string | null;
  transport: string | null;
  day_kind: string | null;
}

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/**
 * Does this stored day actually differ from the printed plan?
 *
 * Every itinerary day now exists as a row, because the plan is copied into the
 * database so photos and bookings have something to attach to. A row is
 * therefore no longer evidence that anything was changed — and treating it as
 * such marked all 41 days "Re-routed" against themselves, which is how the
 * itinerary came to read as though every day had been rewritten.
 *
 * An override is a row that says something different from the plan.
 */
export function differsFromPlan(o: PlanOverride): boolean {
  const planned = ITINERARY.find((d) => d.date === o.day_date);
  if (!planned) return true; // a day the plan never had is a genuine addition

  if (o.from != null && norm(o.from) !== norm(planned.from)) return true;
  if (o.to != null && norm(o.to) !== norm(planned.to)) return true;
  if (o.transport != null && norm(o.transport) !== norm(planned.transport)) return true;
  if (o.day_kind != null && norm(o.day_kind) !== norm(planned.kind ?? "destination")) return true;
  if (o.distance_km != null && Number(o.distance_km) !== Number(planned.distanceKm ?? 0)) {
    return true;
  }
  if (o.duration_min != null && Number(o.duration_min) !== Number(planned.durationMin ?? 0)) {
    return true;
  }
  return false;
}

export function usePlanOverrides() {
  const fetcher = useServerFn(listPublicPlanOverrides);
  const q = useQuery({
    queryKey: ["plan-overrides"],
    queryFn: () => fetcher() as Promise<PlanOverride[]>,
    staleTime: 30_000,
  });
  const map = new Map<string, PlanOverride>();
  for (const r of q.data ?? []) {
    if (r?.day_date && differsFromPlan(r)) map.set(r.day_date, r);
  }
  return { map, isLoading: q.isLoading };
}
