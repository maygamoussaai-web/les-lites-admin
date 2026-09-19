import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { AlertCircle, Home, RotateCcw } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { queryPersister, QUERY_PERSIST_MAX_AGE } from "../lib/query-persist";

function NotFoundComponent() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <p className="font-display text-5xl font-semibold tracking-tight text-primary/80">404</p>
          <h1 className="mt-3 font-display text-xl font-semibold tracking-tight text-foreground">
            Page introuvable
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Cette adresse n'existe pas ou n'est plus accessible. Vérifiez le lien ou retournez à
            l'accueil.
          </p>
          <div className="mt-6">
            <Button asChild className="press">
              <Link to="/">
                <Home className="mr-1.5 h-4 w-4" />
                Accueil
              </Link>
            </Button>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Les Élites de Gao — Administration
        </p>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    // Journal technique uniquement (console / télémétrie) — jamais affiché à l'utilisateur
    console.error(error);
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <AlertCircle className="h-5 w-5" strokeWidth={2} />
          </span>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Page temporairement indisponible
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Le chargement n'a pas abouti. Réessayez ou revenez à l'accueil pour continuer votre
            travail.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              className="press"
              onClick={() => {
                router.invalidate();
                reset();
              }}
            >
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Réessayer
            </Button>
            <Button variant="outline" className="press" asChild>
              <a href="/">
                <Home className="mr-1.5 h-4 w-4" />
                Accueil
              </a>
            </Button>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Les Élites de Gao — Administration
        </p>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Les Élites de Gao – Administration" },
      {
        name: "description",
        content:
          "Administration du complexe scolaire Les Élites de Gao : élèves, enseignants, notes, scolarité et paiements.",
      },
      { name: "author", content: "Les Élites de Gao" },
      { name: "theme-color", content: "#0f2a63" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Élites de Gao" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { property: "og:title", content: "Les Élites de Gao – Administration" },
      {
        property: "og:description",
        content: "Gestion administrative unifiée du complexe scolaire Les Élites de Gao.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@LesElitesDeGao" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700;9..144,900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('eg-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}var r=document.documentElement;if(t==='dark'){r.classList.add('dark');}r.style.colorScheme=t;setTimeout(function(){r.classList.add('theme-anim');},60);}catch(e){}})();`,
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => console.info("[SW] Enregistré :", reg.scope))
      .catch((err) => console.error("[SW] Échec d'enregistrement :", err));
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: queryPersister, maxAge: QUERY_PERSIST_MAX_AGE }}
    >
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </PersistQueryClientProvider>
  );
}
