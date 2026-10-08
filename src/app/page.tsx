import { EngineStatus } from "@/components/layout/engine-status";
import { ValidatorApp } from "@/components/validate/validator-app";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:py-10">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl space-y-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Check your HTML and CSS</h1>
          <p className="text-muted-foreground text-pretty">
            Validate a page, upload files or paste code. MarkupLens runs it through the Nu Html Checker and shows every issue
            with its exact location.
          </p>
        </div>
        <EngineStatus compact />
      </section>
      <ValidatorApp />
    </div>
  );
}
