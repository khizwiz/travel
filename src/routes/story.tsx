import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, CalendarDays, Camera, MapPin } from "lucide-react";
import { useAdminAuth } from "@/lib/admin-auth";
import { formatDateLong, formatDate, getTripProgress, ITINERARY } from "@/lib/trip-data";
import { useApp } from "@/lib/app-state";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPublicDestinationPhotos } from "@/lib/photos.functions";
import { CommentsSection } from "@/components/CommentsSection";
import { StoryUploader } from "@/components/StoryUploader";

export const Route = createFileRoute("/story")({
  head: () => ({
    meta: [
      { title: "Story — Tripping" },
      { name: "description", content: "Photos and moments from the road." },
      { property: "og:title", content: "Tripping story feed" },
      { property: "og:description", content: "Posts and photographs from the Tripping journey." },
    ],
  }),
  component: StoryPage,
});

function StoryPage() {
  const { isAdmin } = useAdminAuth();
  const { liveFix } = useApp();
  const live = liveFix ? { lat: liveFix.lat, lng: liveFix.lng } : null;
  const progress = useMemo(() => getTripProgress(new Date(), live), [live?.lat, live?.lng]);
  const todayDay = progress.todayDay ?? (progress.index >= 0 ? ITINERARY[progress.index] : null);

  const fetchPhotos = useServerFn(listPublicDestinationPhotos);
  const { data: photos, isLoading } = useQuery({
    queryKey: ["public-story-photos"],
    queryFn: () => fetchPhotos(),
    staleTime: 60_000,
  });

  const feed = (photos ?? []).filter((p: any) => p.signedUrl);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            From the road
          </div>
          <h1 className="mt-1 font-display text-3xl">Story</h1>
          <p className="mt-1 text-sm text-muted-foreground">{formatDateLong(progress.todayISO)}</p>
        </div>
        <span className="chip inline-flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5" />
          {progress.phase === "before"
            ? `${progress.daysUntilStart} days to start`
            : progress.phase === "after"
              ? "Trip complete"
              : `Day ${progress.index + 1} / ${ITINERARY.length}`}
        </span>
      </header>

      {todayDay && progress.phase === "active" && (
        <div className="card-elev p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Today on the route
          </div>
          <div className="mt-2 font-display text-xl">
            {todayDay.from}
            {todayDay.to && todayDay.to !== todayDay.from ? ` → ${todayDay.to}` : ""}
          </div>
        </div>
      )}

      {isAdmin && <StoryUploader />}


      {isLoading ? (
        <div className="card-elev p-8 text-center text-sm text-muted-foreground">Loading story…</div>
      ) : feed.length === 0 ? (
        <div className="card-elev flex flex-col items-center gap-3 px-6 py-12 text-center">
          <BookOpen className="h-8 w-8 text-muted-foreground" />
          <h2 className="font-display text-xl">
            {progress.phase === "before" ? "The story opens with the trip" : "No posts yet"}
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {progress.phase === "before"
              ? `The first posts go live the day the wheels turn in Istanbul. Trip starts ${ITINERARY[0].date}.`
              : "Photos from the road will appear here as they're uploaded."}
          </p>
          {isAdmin && (
            <Link to="/planning" className="mt-2 text-sm font-medium text-primary">
              Upload photos in Planning →
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {feed.map((p: any) => (
            <article key={p.id} className="card-elev overflow-hidden p-0">
              <div className="relative aspect-[4/5] w-full overflow-hidden bg-muted">
                <img src={p.signedUrl} alt={p.caption ?? ""} className="h-full w-full object-cover" />
              </div>
              <div className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="chip inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {p.itinerary_days?.title ?? "On the road"}
                  </span>
                  {p.itinerary_days?.day_date && (
                    <span className="chip">{formatDate(p.itinerary_days.day_date)}</span>
                  )}
                  {p.is_cover && <span className="chip chip-gold">Cover</span>}
                </div>
                {p.caption && <p className="text-sm leading-relaxed">{p.caption}</p>}
                <CommentsSection postId={p.post_id ?? null} />
              </div>
            </article>
          ))}
        </div>
      )}

      {isAdmin && feed.length > 0 && (
        <div className="card-elev flex items-center justify-between p-4">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Camera className="h-4 w-4" /> Manage photos & posts
          </div>
          <Link to="/planning" className="text-sm font-medium text-primary">
            Open Planning →
          </Link>
        </div>
      )}
    </div>
  );
}
