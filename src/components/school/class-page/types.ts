/**
 * Types partagés page classe.
 */
import type { ClassSubject } from "@/lib/grades";

export type AveragedStudent = {
  student: { id: string; first_name: string; last_name: string };
  average: number;
  weakSubjects: string[];
};

export type ClassStats = {
  withAvg: AveragedStudent[];
  passing: AveragedStudent[];
  excellent: AveragedStudent[];
  struggling: AveragedStudent[];
  classAverage: number | null;
  highest: AveragedStudent | null;
  lowest: AveragedStudent | null;
  bestSubject: { subject: ClassSubject; avg: number } | null;
  worstSubject: { subject: ClassSubject; avg: number } | null;
  source: "bulletin" | "modele_live" | "empty";
};

export const EMPTY_STATS: ClassStats = {
  withAvg: [],
  passing: [],
  excellent: [],
  struggling: [],
  classAverage: null,
  highest: null,
  lowest: null,
  bestSubject: null,
  worstSubject: null,
  source: "empty",
};
