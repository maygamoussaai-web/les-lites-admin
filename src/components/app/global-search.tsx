import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Building2,
  GraduationCap,
  Search,
  User,
  Users,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";

const MAX_PER_GROUP = 8;

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Score de ressemblance du nom : plus élevé = plus proche. 0 = pas de match. */
function scoreMatch(query: string, ...parts: (string | null | undefined)[]): number {
  if (!query) return 1;
  const tokens = query.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;

  const fields = parts.filter(Boolean).map((p) => norm(String(p)));
  if (!fields.length) return 0;

  const primary = fields[0] ?? ""; // nom principal (ex. "Diallo Amadou")
  const full = fields.join(" ");

  // Tous les tokens doivent apparaître quelque part
  for (const token of tokens) {
    if (!full.includes(token) && !fields.some((f) => f.includes(token))) return 0;
  }

  let score = 0;

  // 1) Correspondance exacte du nom complet
  if (primary === query) score += 1000;
  // 2) Le nom commence par la requête
  else if (primary.startsWith(query)) score += 800;
  // 3) Un mot du nom commence par la requête
  else if (primary.split(/\s+/).some((w) => w.startsWith(query))) score += 600;
  // 4) Le nom contient la requête
  else if (primary.includes(query)) score += 400;

  // Tokens individuels sur le nom principal (poids fort)
  for (const token of tokens) {
    if (primary === token) score += 200;
    else if (primary.startsWith(token)) score += 150;
    else if (primary.split(/\s+/).some((w) => w === token)) score += 120;
    else if (primary.split(/\s+/).some((w) => w.startsWith(token))) score += 90;
    else if (primary.includes(token)) score += 50;
    else {
      // Match uniquement hors nom principal (classe, établissement…)
      for (const field of fields.slice(1)) {
        if (field === token) score += 30;
        else if (field.startsWith(token)) score += 20;
        else if (field.includes(token)) score += 10;
      }
    }
  }

  // Plus le nom est court et proche, mieux c'est (pénalité légère longueur)
  score += Math.max(0, 40 - primary.length);

  return score;
}

/**
 * Recherche globale (Ctrl/Cmd+K) : élèves, enseignants, classes, établissements.
 * Ordre des groupes : établissements → classes → enseignants → élèves.
 * Dans chaque groupe, le nom le plus ressemblant est en premier.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const data = useSchoolData();
  const { isDG, establishmentIds } = useAdminProfile();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const establishments = useMemo(() => {
    const list = data.establishments ?? [];
    if (isDG) return list;
    return list.filter((e) => establishmentIds.includes(e.id));
  }, [data.establishments, isDG, establishmentIds]);

  const classes = useMemo(() => {
    const list = data.classes ?? [];
    if (isDG) return list;
    return list.filter((c) => establishmentIds.includes(c.establishment_id));
  }, [data.classes, isDG, establishmentIds]);

  const students = useMemo(() => {
    const list = data.students ?? [];
    if (isDG) return list;
    return list.filter((s) => establishmentIds.includes(s.establishment_id));
  }, [data.students, isDG, establishmentIds]);

  const teachers = useMemo(() => {
    const list = data.teachers ?? [];
    if (isDG) return list;
    const visibleTeacherIds = new Set(
      (data.assignments ?? [])
        .filter((a) => establishmentIds.includes(a.establishment_id))
        .map((a) => a.teacher_id),
    );
    return list.filter((t) => visibleTeacherIds.has(t.id));
  }, [data.teachers, data.assignments, isDG, establishmentIds]);

  const q = norm(query.trim());

  const filteredStudents = useMemo(() => {
    const ranked = students
      .map((s) => {
        const cls = classes.find((c) => c.id === s.class_id)?.name ?? "";
        const est = establishments.find((e) => e.id === s.establishment_id)?.name ?? "";
        const fullName = `${s.last_name} ${s.first_name}`;
        const score = scoreMatch(q, fullName, s.last_name, s.first_name, cls, est);
        return { s, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.s.last_name.localeCompare(b.s.last_name));
    return ranked.slice(0, MAX_PER_GROUP).map((x) => x.s);
  }, [students, classes, establishments, q]);

  const filteredTeachers = useMemo(() => {
    const ranked = teachers
      .map((t) => {
        const estNames = (data.assignments ?? [])
          .filter((a) => a.teacher_id === t.id)
          .map((a) => establishments.find((e) => e.id === a.establishment_id)?.name ?? "")
          .filter(Boolean);
        const fullName = `${t.last_name} ${t.first_name}`;
        const score = scoreMatch(q, fullName, t.last_name, t.first_name, t.domain, ...estNames);
        return { t, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.t.last_name.localeCompare(b.t.last_name));
    return ranked.slice(0, MAX_PER_GROUP).map((x) => x.t);
  }, [teachers, data.assignments, establishments, q]);

  const filteredClasses = useMemo(() => {
    const ranked = classes
      .map((c) => {
        const est = establishments.find((e) => e.id === c.establishment_id)?.name ?? "";
        const score = scoreMatch(q, c.name, est);
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name));
    return ranked.slice(0, MAX_PER_GROUP).map((x) => x.c);
  }, [classes, establishments, q]);

  const filteredEstablishments = useMemo(() => {
    const ranked = establishments
      .map((e) => {
        const score = scoreMatch(q, e.name);
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
    return ranked.slice(0, MAX_PER_GROUP).map((x) => x.e);
  }, [establishments, q]);

  const go = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const estName = (id: string) =>
    establishments.find((e) => e.id === id)?.name ?? "";
  const className = (id: string | null) =>
    (id && classes.find((c) => c.id === id)?.name) || "";
  const studentCount = (classId: string) =>
    students.filter((s) => s.class_id === classId).length;

  const hasAny =
    filteredStudents.length > 0 ||
    filteredTeachers.length > 0 ||
    filteredClasses.length > 0 ||
    filteredEstablishments.length > 0;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="press hidden h-9 gap-2 rounded-full border-border/70 bg-background/60 px-3 text-muted-foreground sm:inline-flex"
        onClick={() => setOpen(true)}
        aria-label="Rechercher (Ctrl+K)"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="text-xs">Rechercher…</span>
        <kbd className="pointer-events-none ml-1 hidden rounded border border-border/80 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline">
          ⌘K
        </kbd>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="press h-9 w-9 shrink-0 rounded-full sm:hidden"
        onClick={() => setOpen(true)}
        aria-label="Rechercher"
      >
        <Search className="h-4 w-4" />
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Établissement, classe, élève, enseignant…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList className="max-h-[min(70vh,520px)]">
          {!hasAny && (
            <CommandEmpty>
              <div className="flex flex-col items-center gap-1 py-6 text-sm text-muted-foreground">
                <Search className="h-5 w-5 opacity-50" />
                Aucun résultat dans votre périmètre.
              </div>
            </CommandEmpty>
          )}

          {filteredEstablishments.length > 0 && (
            <CommandGroup heading={`Établissements · ${filteredEstablishments.length}`}>
              {filteredEstablishments.map((e) => (
                <CommandItem
                  key={e.id}
                  value={`etab ${e.name}`}
                  className="gap-3 rounded-lg py-2"
                  onSelect={() =>
                    go(() => navigate({ to: "/etablissements/$id", params: { id: e.id } }))
                  }
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Building2 className="h-4 w-4" />
                  </span>
                  <span className="truncate text-sm font-medium">{e.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {filteredClasses.length > 0 && (
            <CommandGroup heading={`Classes · ${filteredClasses.length}${classes.length > MAX_PER_GROUP && !q ? ` / ${classes.length}` : ""}`}>
              {filteredClasses.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`classe ${c.name} ${estName(c.establishment_id)}`}
                  className="gap-3 rounded-lg py-2"
                  onSelect={() =>
                    go(() => navigate({ to: "/classes/$classId", params: { classId: c.id } }))
                  }
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/40 text-foreground">
                    <GraduationCap className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {estName(c.establishment_id)} · {studentCount(c.id)} élève(s)
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {filteredTeachers.length > 0 && (
            <CommandGroup heading={`Enseignants · ${filteredTeachers.length}${teachers.length > MAX_PER_GROUP && !q ? ` / ${teachers.length}` : ""}`}>
              {filteredTeachers.map((t) => {
                const estNames = (data.assignments ?? [])
                  .filter((a) => a.teacher_id === t.id)
                  .map((a) => estName(a.establishment_id))
                  .filter(Boolean);
                return (
                  <CommandItem
                    key={t.id}
                    value={`enseignant ${t.last_name} ${t.first_name} ${t.domain ?? ""} ${estNames.join(" ")}`}
                    className="gap-3 rounded-lg py-2"
                    onSelect={() =>
                      go(() => navigate({ to: "/enseignants/$teacherId", params: { teacherId: t.id } }))
                    }
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/40 text-[11px] font-semibold text-foreground">
                      {(t.last_name[0] ?? "") + (t.first_name[0] ?? "")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {t.last_name} {t.first_name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[t.domain, estNames.join(" · ")].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {filteredStudents.length > 0 && (
            <CommandGroup heading={`Élèves · ${filteredStudents.length}${students.length > MAX_PER_GROUP && !q ? ` / ${students.length}` : ""}`}>
              {filteredStudents.map((s) => {
                const cls = className(s.class_id);
                const est = estName(s.establishment_id);
                return (
                  <CommandItem
                    key={s.id}
                    value={`eleve ${s.last_name} ${s.first_name} ${cls} ${est}`}
                    className="gap-3 rounded-lg py-2"
                    onSelect={() =>
                      go(() => navigate({ to: "/eleves/$studentId", params: { studentId: s.id } }))
                    }
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                      {(s.last_name[0] ?? "") + (s.first_name[0] ?? "")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {s.last_name} {s.first_name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[cls || "Sans classe", est].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          <CommandGroup heading="Accès rapide">
            <CommandItem className="gap-3" onSelect={() => go(() => navigate({ to: "/tableau-de-bord" }))}>
              <Users className="h-4 w-4" /> Tableau de bord
            </CommandItem>
            <CommandItem className="gap-3" onSelect={() => go(() => navigate({ to: "/eleves" }))}>
              <User className="h-4 w-4" /> Tous les élèves
            </CommandItem>
            <CommandItem className="gap-3" onSelect={() => go(() => navigate({ to: "/enseignants" }))}>
              <Users className="h-4 w-4" /> Tous les enseignants
            </CommandItem>
            <CommandItem className="gap-3" onSelect={() => go(() => navigate({ to: "/etablissements" }))}>
              <Building2 className="h-4 w-4" /> Établissements
            </CommandItem>
          </CommandGroup>
        </CommandList>
        <div className="flex items-center justify-between border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
          <span>↑↓ naviguer · Entrée ouvrir · Échap fermer</span>
          <span>{isDG ? "Tout le complexe" : "Votre périmètre"}</span>
        </div>
      </CommandDialog>
    </>
  );
}
