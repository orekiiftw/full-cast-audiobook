import { Card } from "../ui";
import type { BookStatus } from "../../types/api";
import type { ProgressLogEntry } from "./detailsData";

interface StudioConsoleProps {
  progressLog: ProgressLogEntry[];
  bookStatus: BookStatus;
}

export function StudioConsole({ progressLog, bookStatus }: StudioConsoleProps) {
  return (
    <Card className="p-5 mb-12 overflow-hidden relative">
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gold-500/10 blur-2xl" />
      <h3 className="label-caps text-gold-400 mb-4 flex items-center gap-2">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-50" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-gold-400" />
        </span>
        Studio console
      </h3>
      <div className="font-mono text-[11px] text-cinema-400 max-h-28 overflow-y-auto space-y-1.5 pr-2">
        {progressLog.length === 0 ? (
          <p className="italic text-cinema-600">
            {bookStatus === "discovering" ? "Starting up — acquisition and parsing updates land here shortly…" : "Waiting for cues…"}
          </p>
        ) : (
          progressLog.map((log) => (
            <div key={log.id} className="flex gap-2">
              <span className="text-gold-600/80 select-none">›</span>
              <span className={logToneClass(log.text)}>{log.text}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function logToneClass(text: string): string | undefined {
  if (/fail|error|quota|⛔|❌/i.test(text)) return "text-red-300";
  if (/warn|⚠️/i.test(text)) return "text-amber-300";
  return undefined;
}
