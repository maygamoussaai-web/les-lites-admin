/**
 * Champ mot de passe avec icône œil (afficher / masquer).
 * À utiliser pour TOUS les champs mot de passe de l'app.
 */
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PasswordField({
  id = "password",
  label = "Mot de passe",
  value,
  onChange,
  placeholder,
  required,
  minLength,
  autoComplete = "current-password",
  autoFocus,
  disabled,
  className,
  inputClassName,
}: {
  id?: string;
  label?: string | null;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className={cn(label ? "space-y-1.5" : undefined, className)}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          className={cn("pr-10", inputClassName)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          tabIndex={-1}
          className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          disabled={disabled}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

/** Vérifie le mot de passe de la session courante via re-auth Supabase. */
export async function verifyCurrentPassword(password: string): Promise<boolean> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data: sessionData } = await supabase.auth.getSession();
  const email = sessionData.session?.user?.email;
  if (!email) return false;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return !error;
}
