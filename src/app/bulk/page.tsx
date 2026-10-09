import type { Metadata } from "next";
import { BulkApp } from "@/components/bulk/bulk-app";

export const metadata: Metadata = {
  title: "Bulk validation",
  description: "Validate up to 200 pages at once from a sitemap or a list of URLs.",
};

export default function BulkPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:py-10">
      <section className="max-w-2xl space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Validate a whole site</h1>
        <p className="text-muted-foreground text-pretty">
          Pick pages from a sitemap or paste a list of up to 200 URLs. Pages are checked a few at a time, with live progress, and
          you can cancel at any point.
        </p>
      </section>
      <BulkApp />
    </div>
  );
}
