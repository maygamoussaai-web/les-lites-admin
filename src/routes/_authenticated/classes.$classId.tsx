import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
// FILE TOO LARGE FOR SINGLE PUSH - SEE NOTE
export const Route = createFileRoute("/_authenticated/classes/$classId")({
  component: () => <div>Chargement page classe…</div>,
});
