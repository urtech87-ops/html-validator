import { CircleX, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Severity } from "@/lib/validation/types";

export const SEVERITY_META: Record<
  Severity,
  { label: string; plural: string; Icon: LucideIcon; text: string; soft: string; border: string; highlight: string }
> = {
  error: {
    label: "Error",
    plural: "Errors",
    Icon: CircleX,
    text: "text-destructive",
    soft: "bg-destructive/8",
    border: "border-l-destructive",
    highlight: "bg-destructive/20 text-foreground underline decoration-destructive decoration-wavy underline-offset-4",
  },
  warning: {
    label: "Warning",
    plural: "Warnings",
    Icon: TriangleAlert,
    text: "text-warning-foreground",
    soft: "bg-warning/12",
    border: "border-l-warning",
    highlight: "bg-warning/35 text-foreground underline decoration-warning-foreground decoration-wavy underline-offset-4",
  },
  info: {
    label: "Info",
    plural: "Info",
    Icon: Info,
    text: "text-info",
    soft: "bg-info/8",
    border: "border-l-info",
    highlight: "bg-info/20 text-foreground underline decoration-info underline-offset-4",
  },
};

export function SeverityIcon({ severity, className = "size-4" }: { severity: Severity; className?: string }) {
  const { Icon, text, label } = SEVERITY_META[severity];
  return <Icon className={`${text} ${className} shrink-0`} aria-label={label} role="img" />;
}
