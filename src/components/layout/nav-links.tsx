"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Validate" },
  { href: "/bulk", label: "Bulk" },
  { href: "/history", label: "History" },
  { href: "/api-docs", label: "API" },
];

/** Active link follows the URL. Wrapped in Suspense by the header: on dynamic routes the pathname is runtime data. */
export function NavLinks() {
  return <NavLinkList pathname={usePathname()} />;
}

/** The links themselves; without a pathname (Suspense fallback) none is marked active. */
export function NavLinkList({ pathname }: { pathname?: string }) {
  return (
    <>
      {LINKS.map(({ href, label }) => {
        const active = pathname !== undefined && (href === "/" ? pathname === "/" : pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2 py-1.5 text-sm sm:px-3 font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
              active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}
