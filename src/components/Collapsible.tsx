import type { ReactNode } from "react";

/** A closed-by-default section for reference material, below the live data. */
export function Collapsible({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <details className="group">
      <summary className="panel flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:border-cyan/40 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink">{title}</span>
          {hint && <span className="ml-2 text-xs text-mute">{hint}</span>}
        </span>
        <span aria-hidden className="text-mute transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="mt-3 space-y-4 sm:space-y-5">{children}</div>
    </details>
  );
}
