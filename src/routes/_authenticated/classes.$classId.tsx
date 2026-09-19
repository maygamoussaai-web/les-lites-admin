import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
// RESTORE_MARKER - full file must replace
export const Route = createFileRoute("/_authenticated/classes/$classId")({ component: () => null });
