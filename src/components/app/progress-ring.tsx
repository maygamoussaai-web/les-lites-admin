export function ProgressRing({
  value,
  max,
  label,
  caption,
  size = 156,
  stroke = 12,
  color = "var(--color-accent)",
}: {
  value: number;
  max: number;
  label: string;
  caption?: string;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-muted)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
            style={{
              // @ts-expect-error custom property
              "--ring-circumference": `${circumference}px`,
              animation: "ring-draw 1.1s cubic-bezier(0.22, 1, 0.36, 1) both",
              transition: "stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl font-semibold text-foreground">
            {Math.round(ratio * 100)}%
          </span>
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        </div>
      </div>
      {caption ? <p className="text-center text-xs text-muted-foreground">{caption}</p> : null}
    </div>
  );
}
