export function OutLink({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-8 items-center rounded-md border border-cyan/40 bg-cyan/10 px-2 py-1 text-xs text-cyan hover:underline"
    >
      {children}
      <span className="ml-1 text-[10px] text-cyan/70">↗</span>
    </a>
  );
}
