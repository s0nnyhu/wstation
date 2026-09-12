"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-xl font-semibold">Could not load station data</h1>
      <p className="mt-3 text-sm text-mute">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-lg border border-cyan/40 bg-cyan/10 px-3 py-2 text-sm text-cyan"
      >
        Retry
      </button>
    </div>
  );
}
