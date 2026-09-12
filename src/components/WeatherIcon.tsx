import type { WeatherIconKind } from "@/lib/weatherIcon";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Sun() {
  return (
    <g>
      <circle cx="12" cy="12" r="3.2" {...STROKE} />
      <path
        d="M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8M6.1 6.1l1.3 1.3M16.6 16.6l1.3 1.3M6.1 17.9l1.3-1.3M16.6 7.4l1.3-1.3"
        {...STROKE}
      />
    </g>
  );
}

function Moon() {
  return (
    <path
      d="M15.2 4.8A6.6 6.6 0 1 0 19 14.4 5.2 5.2 0 0 1 15.2 4.8z"
      {...STROKE}
    />
  );
}

function Cloud({ y = 0 }: { y?: number }) {
  return (
    <path
      transform={`translate(0 ${y})`}
      d="M7.2 16.4h9.4a3.3 3.3 0 0 0 .2-6.6 4.4 4.4 0 0 0-8.4-1.4 3.2 3.2 0 0 0-1.2 8z"
      {...STROKE}
    />
  );
}

function RainDrops() {
  return (
    <path d="M8.4 18.4l-.6 1.8M12 18.2l-.6 1.8M15.6 18.4l-.6 1.8" {...STROKE} />
  );
}

export function WeatherIcon({
  kind,
  className = "h-5 w-5",
  title,
}: {
  kind: WeatherIconKind;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      {kind === "clear" && <Sun />}
      {kind === "night" && <Moon />}
      {kind === "partly" && (
        <g>
          <g transform="translate(-2 -3) scale(0.72)">
            <Sun />
          </g>
          <Cloud y={1} />
        </g>
      )}
      {kind === "cloudy" && <Cloud />}
      {kind === "rain" && (
        <g>
          <Cloud y={-1.4} />
          <RainDrops />
        </g>
      )}
      {kind === "thunder" && (
        <g>
          <Cloud y={-2} />
          <path d="M11.2 16.2l1.8 0.1-1.4 3.4 3.2-3.6-1.8-.1 1.2-2.6z" {...STROKE} />
        </g>
      )}
      {kind === "fog" && (
        <g>
          <path d="M5 9.2h14M4.4 12.4h15.2M6 15.6h12" {...STROKE} />
        </g>
      )}
    </svg>
  );
}
