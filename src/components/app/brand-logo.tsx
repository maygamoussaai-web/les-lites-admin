import { cn } from "@/lib/utils";

/**
 * Logo institutionnel « Les Élites de Gao ».
 * Une seule source d'image pour toute l'app : remplacer /logo-eg.png suffit.
 */
export function BrandLogo({
  className,
  size = 48,
  halo = false,
  float = false,
  alt = "Logo Les Élites de Gao",
}: {
  className?: string;
  size?: number;
  halo?: boolean;
  float?: boolean;
  alt?: string;
}) {
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      {halo ? (
        <span
          aria-hidden
          className="animate-glow-pulse absolute inset-[-22%] rounded-full blur-2xl"
          style={{ background: "radial-gradient(circle, oklch(0.78 0.16 85 / 38%), transparent 70%)" }}
        />
      ) : null}
      <img
        src="/logo-eg.png"
        alt={alt}
        width={size}
        height={size}
        loading="eager"
        decoding="async"
        className={cn(
          "logo-crisp relative h-full w-full select-none object-contain drop-shadow-[0_8px_18px_oklch(0.22_0.06_258/35%)]",
          float && "animate-emblem-float",
        )}
      />
    </span>
  );
}
