// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReportDialog } from "@/components/report/report-dialog";
import { arabicRun } from "../helpers/report-fixtures";

// jsdom has no ResizeObserver; Radix checkboxes measure themselves with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function open(verbose: boolean) {
  render(<ReportDialog source={() => ({ kind: "single", run: arabicRun() })} verbose={verbose} />);
  fireEvent.click(screen.getByRole("button", { name: /generate report/i }));
}

describe("ReportDialog", () => {
  it("opens with every content toggle on except info for a non-verbose run", () => {
    open(false);
    expect(screen.getByRole("dialog", { name: "Generate report" })).toBeInTheDocument();
    for (const name of ["Executive summary", "Errors", "Warnings", "Source extracts", "Structure analysis", "Heading outline", "Image report"]) {
      expect(screen.getByRole("checkbox", { name: new RegExp(`^${name}`) })).toBeChecked();
    }
    expect(screen.getByRole("checkbox", { name: /^Info messages/ })).not.toBeChecked();
    expect((screen.getByLabelText("Report date") as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("includes info for a verbose run and disables toggles CSV ignores", () => {
    open(true);
    expect(screen.getByRole("checkbox", { name: /^Info messages/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "CSV (issues)" }));
    expect(screen.getByRole("checkbox", { name: /^Executive summary/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /^Heading outline/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /^Errors/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeInTheDocument();
  });
});
