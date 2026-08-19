// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        // Ce projet est en SSR (TanStack Start / Nitro) : il n'y a pas d'index.html
        // unique à patcher. Le <link rel="manifest"> et l'enregistrement du service
        // worker sont déjà faits à la main dans __root.tsx.
        injectRegister: false,
        manifest: false,
        registerType: "autoUpdate",
        // Activé aussi en dev/aperçu pour pouvoir tester le offline directement
        // dans l'aperçu Lovable, sans attendre un build de production.
        devOptions: { enabled: true, type: "module" },
        workbox: {
          // Précache les assets statiques buildés (JS/CSS/police/icônes) : c'est ce
          // qui permet à l'app elle-même (pas seulement ses données) de démarrer
          // hors ligne.
          globPatterns: ["**/*.{js,css,woff2,png,svg,ico}"],
          runtimeCaching: [
            {
              // Chaque page déjà ouverte en ligne est mise en cache par URL, pour
              // pouvoir être rejouée hors ligne (pas de shell SPA unique possible
              // ici puisque le HTML est rendu par le serveur à chaque route).
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "eg-pages",
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
            {
              // Images (avatars, icônes) : servies du cache en priorité, revalidées
              // en arrière-plan.
              urlPattern: ({ url }) =>
                url.origin === self.location.origin && /\.(?:png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "eg-images",
                expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
      }),
    ],
  },
});
