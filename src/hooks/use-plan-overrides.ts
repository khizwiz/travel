import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPublicPlanOverrides } from "@/lib/reroute.functions";

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

export function usePlanOverrides() {
  const fetcher = useServerFn(listPublicPlanOverrides);
  const q = useQuery({
    queryKey: ["plan-overrides"],
    queryFn: () => fetcher() as Promise<PlanOverride[]>,
    staleTime: 30_000,
  });
  const map = new Map<string, PlanOverride>();
  for (const r of q.data ?? []) if (r?.day_date) map.set(r.day_date, r);
  return { map, isLoading: q.isLoading };
}
