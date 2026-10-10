import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function HistoryUnavailable() {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>History is not available</AlertTitle>
      <AlertDescription>
        The history database could not be opened. With <code>npm run dev</code>, run <code>npm run db:migrate</code> once; in Docker the app
        applies migrations when it starts (see the container log).
      </AlertDescription>
    </Alert>
  );
}
