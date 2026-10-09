import { Loader2, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SubmitButton({ busy, disabled, label = "Validate" }: { busy: boolean; disabled?: boolean; label?: string }) {
  return (
    <Button type="submit" size="lg" className="h-9 px-4" disabled={busy || disabled} aria-busy={busy}>
      {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ScanSearch aria-hidden="true" />}
      {busy ? "Validating…" : label}
    </Button>
  );
}
