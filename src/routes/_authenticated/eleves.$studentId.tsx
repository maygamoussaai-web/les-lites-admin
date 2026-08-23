import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/eleves/$studentId")({
  component: Outlet,
});