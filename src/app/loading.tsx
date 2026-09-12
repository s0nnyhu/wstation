export default function Loading() {
  return (
    <div className="min-h-full bg-bg px-6 py-10">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="h-16 animate-pulse rounded-2xl bg-surface" />
        <div className="h-56 animate-pulse rounded-2xl bg-surface" />
        <div className="h-72 animate-pulse rounded-2xl bg-surface" />
      </div>
    </div>
  );
}
