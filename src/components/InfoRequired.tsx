import { AlertCircle } from "lucide-react";

interface Props {
  title?: string;
  what: string;
  why?: string;
  where?: string;
}

export function InfoRequired({ title = "Information required", what, why, where }: Props) {
  return (
    <div className="card-elev p-4 border-l-4 border-l-warning">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-warning">
          <AlertCircle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-sm text-foreground">{what}</div>
          {why ? (
            <div className="mt-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">Why:</span> {why}
            </div>
          ) : null}
          {where ? (
            <div className="mt-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">Where:</span> {where}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
