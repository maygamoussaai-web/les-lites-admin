import { BrandLogo } from "@/components/app/brand-logo";

/**
 * Arrière-plan ambiant premium : dégradés aurora, halo doré, filigrane du logo
 * institutionnel et grain subtil. Purement décoratif et non interactif.
 */
export function AuroraBackground({
  intense = false,
  watermark = true,
}: {
  intense?: boolean;
  watermark?: boolean;
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
      {watermark ? (
        <div className="logo-watermark absolute inset-0 flex items-center justify-center">
          <BrandLogo size={520} alt="" className="max-w-[80vw]" />
        </div>
      ) : null}
      <div className="grain absolute inset-0" />
    </div>
  );
}
