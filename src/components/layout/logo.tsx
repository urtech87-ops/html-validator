/** MarkupLens wordmark: a lens framing a pair of angle brackets. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-heading font-semibold tracking-tight ${className ?? ""}`}>
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" className="shrink-0">
        <circle cx="14" cy="14" r="10.5" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-primary" />
        <path d="M22 22l6.5 6.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-primary" />
        <path
          d="M11.5 10 8 14l3.5 4M16.5 10l3.5 4-3.5 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-lg">
        Markup<span className="text-primary">Lens</span>
      </span>
    </span>
  );
}
