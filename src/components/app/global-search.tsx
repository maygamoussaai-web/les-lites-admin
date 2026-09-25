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

  const go = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const estName = (id: string) =>
    establishments.find((e) => e.id === id)?.name ?? "";

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
        <CommandInput placeholder="Élève, classe, établissement…" />
        <CommandList>
          <CommandEmpty>Aucun résultat.</CommandEmpty>

          <CommandGroup heading="Pages">
            <CommandItem
              onSelect={() => go(() => navigate({ to: "/tableau-de-bord" }))}
            >
              <Users className="mr-2 h-4 w-4" />
              Tableau de bord
            </CommandItem>
            <CommandItem onSelect={() => go(() => navigate({ to: "/eleves" }))}>
              <User className="mr-2 h-4 w-4" />
              Tous les élèves
            </CommandItem>
            <CommandItem
              onSelect={() => go(() => navigate({ to: "/etablissements" }))}
            >
              <Building2 className="mr-2 h-4 w-4" />
              Établissements
            </CommandItem>
          </CommandGroup>

          {establishments.length > 0 && (
            <CommandGroup heading="Établissements">
              {establishments.slice(0, 20).map((e) => (
                <CommandItem
                  key={e.id}
                  value={`etab ${e.name}`}
                  onSelect={() =>
                    go(() =>
                      navigate({
                        to: "/etablissements/$id",
                        params: { id: e.id },
                      }),
                    )
                  }
                >
                  <Building2 className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">{e.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {classes.length > 0 && (
            <CommandGroup heading="Classes">
              {classes.slice(0, 40).map((c) => (
                <CommandItem
                  key={c.id}
                  value={`classe ${c.name} ${estName(c.establishment_id)}`}
                  onSelect={() =>
                    go(() =>
                      navigate({
                        to: "/classes/$classId",
                        params: { classId: c.id },
                      }),
                    )
                  }
                >
                  <GraduationCap className="mr-2 h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">
                    {c.name}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {estName(c.establishment_id)}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {students.length > 0 && (
            <CommandGroup heading="Élèves">
              {students.slice(0, 50).map((s) => (
                <CommandItem
                  key={s.id}
                  value={`eleve ${s.last_name} ${s.first_name}`}
                  onSelect={() =>
                    go(() =>
                      navigate({
                        to: "/eleves/$studentId",
                        params: { studentId: s.id },
                      }),
                    )
                  }
                >
                  <User className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {s.last_name} {s.first_name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
