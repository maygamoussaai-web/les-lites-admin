import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle, mounted } = useTheme();
  const dark = theme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={dark ? "Passer en mode clair" : "Passer en mode sombre"}
      title={dark ? "Mode clair" : "Mode sombre"}
      className={`press relative overflow-hidden rounded-full ${className ?? ""}`}
    >
      <span className="sr-only">{dark ? "Mode clair" : "Mode sombre"}</span>
      {mounted ? (
        <span className="relative block h-4 w-4">
          <Sun
            className={`absolute inset-0 h-4 w-4 transition-all duration-500 ${
              dark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
            }`}
          />
          <Moon
            className={`absolute inset-0 h-4 w-4 transition-all duration-500 ${
              dark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"
            }`}
          />
        </span>
      ) : (
        <Sun className="h-4 w-4 opacity-40" />
      )}
    </Button>
  );
}