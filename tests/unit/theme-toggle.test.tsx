// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeToggle } from "@/components/theme/theme-toggle";

describe("ThemeToggle", () => {
  it("renders an accessible trigger button", () => {
    window.matchMedia ??= ((query: string) =>
      ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Change colour theme" })).toBeInTheDocument();
  });
});
