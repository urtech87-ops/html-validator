import { Suspense } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Logo } from "./logo";
import { NavLinkList, NavLinks } from "./nav-links";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4">
        <Link
          href="/"
          className="rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label="MarkupLens home"
        >
          <Logo compact />
        </Link>
        <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5 sm:gap-1">
          <Suspense fallback={<NavLinkList />}>
            <NavLinks />
          </Suspense>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
