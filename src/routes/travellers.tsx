import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getDefaultTrip } from "@/lib/access.functions";
import { ensureTripScaffold } from "@/lib/scaffold.functions";
import { TravellersManager } from "@/components/TravellersManager";

export const Route = createFileRoute("/travellers")({
  head: () => ({ meta: [{ title: "Travellers — Tripping" }] }),
  component: TravellersPage,
});

function TravellersPage() {
  const { user, isOwner, loading } = useAuth();
  const fetchTrip = useServerFn(getDefaultTrip);
  const ensureScaffold = useServerFn(ensureTripScaffold);
  const [tripId, setTripId] = useState<string | null>(null);
  const [scaffoldErr, setScaffoldErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchTrip().then(async (t) => {
      if (!alive) return;
      if (t?.id) { setTripId(t.id); return; }
      // Fresh database: create trip + days + photo bucket, then retry.
      try {
        await ensureScaffold();
        const t2 = await fetchTrip();
        if (alive && t2?.id) setTripId(t2.id);
      } catch (e: any) {
        if (alive) setScaffoldErr(e?.message ?? "Could not initialise the trip.");
      }
    }).catch((e: any) => { if (alive) setScaffoldErr(e?.message ?? "Failed to load trip"); });
    return () => { alive = false; };
  }, [fetchTrip, ensureScaffold]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!user || !isOwner) {
    return (
      <div className="card-elev p-6 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
        <div className="mt-2 font-medium">Owner sign-in required</div>
      </div>
    );
  }
  return (
    <div className="card-elev p-5">
      <h1 className="font-display text-2xl">People on this trip</h1>
      {tripId
        ? <TravellersManager tripId={tripId} />
        : scaffoldErr
          ? <div className="mt-3 text-sm text-destructive">{scaffoldErr}</div>
          : <div className="mt-3 text-sm text-muted-foreground">Loading…</div>}
    </div>
  );
}
