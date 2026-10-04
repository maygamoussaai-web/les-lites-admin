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

/**
 * Recherche globale (Ctrl/Cmd+K) : élèves, classes, établissements.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
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

  // NOTE POUR CLAUDE: enseignants limités au périmètre via leurs affectations
  // (un enseignant n'a pas d'establishment_id propre, on passe par teacher_assignments).
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

      {/* NOTE POUR CLAUDE: résultats limités au périmètre de l'utilisateur (filtres ci-dessus) ;
          chaque élève est sous-titré « classe · établissement ». */}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Rechercher un élève, une classe, un établissement…" />
        <CommandList className="max-h-[min(70vh,520px)]">
          <CommandEmpty>
            <div className="flex flex-col items-center gap-1 py-6 text-sm text-muted-foreground">
              <Search className="h-5 w-5 opacity-50" />
              Aucun résultat dans votre périmètre.
            </div>
          </CommandEmpty>

          {students.length > 0 && (
            <CommandGroup heading={`Élèves · ${students.length}`}>
              {students.map((s) => {
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

          {teachers.length > 0 && (
            <CommandGroup heading={`Enseignants · ${teachers.length}`}>
              {teachers.map((t) => {
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

          {classes.length > 0 && (
            <CommandGroup heading={`Classes · ${classes.length}`}>
              {classes.map((c) => (
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

          {establishments.length > 0 && (
            <CommandGroup heading="Établissements">
              {establishments.map((e) => (
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

          <CommandGroup heading="Accès rapide">
            <CommandItem className="gap-3" onSelect={() => go(() => navigate({ to: "/tableau-de-bord" }))}>
              <Users className="h-4 w-4" /> Tableau de bord
            </CommandItem>
            <CommandItem className="gap-3" onSelect={() => go(() => navigate({ to: "/eleves" }))}>
              <User className="h-4 w-4" /> Tous les élèves
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
