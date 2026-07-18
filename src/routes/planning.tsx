import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/planning")({
  head: () => ({ meta: [{ title: "Planning — Tripping" }] }),
  component: () => <Navigate to="/bookings" replace />,
});
