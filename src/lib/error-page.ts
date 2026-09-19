/** Page d'erreur serveur — HTML autonome, ton institutionnel, sans jargon. */
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Page indisponible – Les Élites de Gao</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#0f2a63" />
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f4f6fa;
        --fg: #1a2744;
        --muted: #5c6b85;
        --card: #ffffff;
        --border: #e2e8f0;
        --primary: #1e3a6e;
        --primary-fg: #f8fafc;
        --accent: #c9a227;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0c1222;
          --fg: #e8eef8;
          --muted: #94a3b8;
          --card: #141c2e;
          --border: #243044;
          --primary: #3b5bdb;
          --primary-fg: #f8fafc;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        font: 15px/1.55 "Plus Jakarta Sans", system-ui, -apple-system, sans-serif;
        background: var(--bg);
        color: var(--fg);
      }
      .shell {
        width: 100%;
        max-width: 26rem;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 1rem;
        padding: 2rem 1.75rem;
        box-shadow: 0 12px 40px rgba(15, 42, 99, 0.06);
      }
      .mark {
        width: 2.75rem;
        height: 2.75rem;
        border-radius: 0.75rem;
        display: grid;
        place-items: center;
        background: color-mix(in srgb, var(--primary) 12%, transparent);
        color: var(--primary);
        margin-bottom: 1.25rem;
      }
      .mark svg { width: 1.35rem; height: 1.35rem; }
      h1 {
        margin: 0;
        font-family: Fraunces, Georgia, serif;
        font-size: 1.35rem;
        font-weight: 600;
        letter-spacing: -0.02em;
      }
      p {
        margin: 0.6rem 0 0;
        color: var(--muted);
        font-size: 0.9rem;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 1.5rem;
      }
      button, a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.55rem 1rem;
        border-radius: 0.5rem;
        font: inherit;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
        border: 1px solid transparent;
      }
      .primary { background: var(--primary); color: var(--primary-fg); }
      .primary:hover { filter: brightness(1.06); }
      .secondary {
        background: transparent;
        color: var(--fg);
        border-color: var(--border);
      }
      .secondary:hover { background: color-mix(in srgb, var(--fg) 4%, transparent); }
      .brand {
        margin-top: 1.25rem;
        text-align: center;
        font-size: 0.75rem;
        color: var(--muted);
        letter-spacing: 0.02em;
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="card">
        <div class="mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h1>Page temporairement indisponible</h1>
        <p>Le chargement n'a pas abouti. Vous pouvez réessayer ou revenir à l'accueil.</p>
        <div class="actions">
          <button class="primary" type="button" onclick="location.reload()">Réessayer</button>
          <a class="secondary" href="/">Accueil</a>
        </div>
      </div>
      <p class="brand">Les Élites de Gao — Administration</p>
    </div>
  </body>
</html>`;
}
