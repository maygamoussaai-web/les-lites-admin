/**
 * Arrière-plan ambiant premium : dégradés aurora, halo doré,
 * silhouette du patrimoine de Gao et grain subtil. Purement décoratif.
 */
export function AuroraBackground({
  intense = false,
}: {
  intense?: boolean;
}) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      <div className="tomb-veil absolute inset-x-0 bottom-0 h-[52vh] min-h-[280px]" />
      <div className="aurora-mesh absolute inset-0" />
      <div className="beam-veil absolute inset-0" />
      <div
        className="animate-drift-slow absolute -top-40 -left-32 h-[38rem] w-[38rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, oklch(0.45 0.16 258 / 22%), transparent 65%)" }}
      />
      <div
        className="animate-drift-slower absolute -bottom-48 -right-24 h-[34rem] w-[34rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, oklch(0.78 0.16 85 / 18%), transparent 65%)" }}
      />
      {intense ? (
        <div
          className="animate-glow-pulse absolute left-1/2 top-1/3 h-[26rem] w-[26rem] -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.62 0.12 200 / 16%), transparent 70%)" }}
        />
      ) : null}
      <div className="grain absolute inset-0" />
    </div>
  );
}
