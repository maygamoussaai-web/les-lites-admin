/**
 * Partage multi-canal : feuille native (mobile) + alternatives WhatsApp, SMS, e-mail, Telegram, copier.
 * Ne retire jamais le bouton Copier — toujours disponible.
 */
import { useState } from "react";
import { Copy, Mail, MessageCircle, Share2, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type SharePayload = {
  url: string;
  title?: string;
  text?: string;
};

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

function openExternal(href: string) {
  window.open(href, "_blank", "noopener,noreferrer");
}

export function ShareSheet({
  payload,
  label = "Partager",
  size = "sm",
  variant = "default",
  className,
  triggerClassName,
}: {
  payload: SharePayload;
  label?: string;
  size?: "sm" | "default" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost";
  className?: string;
  triggerClassName?: string;
}) {
  const [copied, setCopied] = useState(false);
  const title = payload.title ?? "Les Élites de Gao";
  const text = payload.text ?? "";
  const url = payload.url;

  const doCopy = async () => {
    try {
      await copyToClipboard(url);
      setCopied(true);
      toast.success("Lien copié");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copie impossible");
    }
  };

  const doNativeShare = async () => {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
      toast.message("Choisissez un canal ci-dessous");
      return;
    }
    try {
      await navigator.share({ title, text: text ? `${text}\n${url}` : url, url });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      toast.message("Utilisez une option de partage ci-dessous");
    }
  };

  const whatsapp = () => {
    const body = encodeURIComponent(text ? `${text}\n${url}` : url);
    openExternal(`https://wa.me/?text=${body}`);
  };
  const sms = () => {
    const body = encodeURIComponent(text ? `${text} ${url}` : url);
    // iOS uses &body=, Android uses ?body=
    openExternal(`sms:?&body=${body}`);
  };
  const email = () => {
    const subject = encodeURIComponent(title);
    const body = encodeURIComponent(text ? `${text}\n\n${url}` : url);
    openExternal(`mailto:?subject=${subject}&body=${body}`);
  };
  const telegram = () => {
    const body = encodeURIComponent(text ? `${text}\n${url}` : url);
    openExternal(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${body}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size={size}
          variant={variant}
          className={cn("press", triggerClassName, className)}
          aria-label={label}
        >
          <Share2 className={cn(size === "icon" ? "h-4 w-4" : "mr-1.5 h-3.5 w-3.5")} />
          {size !== "icon" ? label : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Partager via
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {typeof navigator !== "undefined" && typeof navigator.share === "function" ? (
          <DropdownMenuItem onSelect={() => void doNativeShare()} className="gap-2 cursor-pointer">
            <Share2 className="h-4 w-4 text-primary" />
            Partage système…
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={whatsapp} className="gap-2 cursor-pointer">
          <MessageCircle className="h-4 w-4 text-emerald-600" />
          WhatsApp
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={sms} className="gap-2 cursor-pointer">
          <MessageCircle className="h-4 w-4 text-sky-600" />
          SMS
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={email} className="gap-2 cursor-pointer">
          <Mail className="h-4 w-4 text-amber-700" />
          E-mail
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={telegram} className="gap-2 cursor-pointer">
          <Share2 className="h-4 w-4 text-sky-500" />
          Telegram
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void doCopy()} className="gap-2 cursor-pointer">
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copié" : "Copier le lien"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
