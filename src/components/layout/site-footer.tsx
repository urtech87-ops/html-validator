import { Suspense } from "react";
import { connection } from "next/server";
import { ShieldAlert } from "lucide-react";
import { getConfig } from "@/lib/config";

/** Shown when ALLOW_PRIVATE_URLS=true. Read at request time so Docker env applies. */
async function PrivateUrlsNotice() {
  await connection();
  if (!getConfig().allowPrivateUrls) return null;
  return (
    <p className="inline-flex items-center gap-1.5 text-warning-foreground" data-testid="private-urls-notice">
      <ShieldAlert className="size-3.5" aria-hidden="true" />
      Private URLs allowed (ALLOW_PRIVATE_URLS=true)
    </p>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>MarkupLens — validation powered by the self-hosted Nu Html Checker (vnu).</p>
        <Suspense fallback={null}>
          <PrivateUrlsNotice />
        </Suspense>
      </div>
    </footer>
  );
}
