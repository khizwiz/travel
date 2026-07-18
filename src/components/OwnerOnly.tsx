import { useAdminAuth } from "@/lib/admin-auth";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Renders children only for the owner. Miezko (crew) sees a locked notice.
 * Public visitors (not signed in as admin) also see the notice.
 */
export function OwnerOnly({ children, page }: { children: ReactNode; page: string }) {
  const { role, loading } = useAdminAuth();
  if (loading) return null;
  if (role === "owner") return <>{children}</>;
  return (
    <div className="card-elev flex flex-col items-center gap-2 p-8 text-center">
      <Lock className="h-8 w-8 text-muted-foreground" />
      <h1 className="font-display text-2xl">{page}</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {role === "crew"
          ? "This section is reserved for the trip owner."
          : "Sign in as the trip owner to view this page."}
      </p>
    </div>
  );
}
