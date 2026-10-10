import { LevelMeter, ProgressBar } from "../ui";
import type { BookStatus } from "../../types/api";
import type { ProgressLogEntry } from "./detailsData";

interface StudioConsoleProps {
  progressLog: ProgressLogEntry[];
  bookStatus: BookStatus;
}

export function StudioConsole({ progressLog, bookStatus }: StudioConsoleProps) {
  return (
    <section
      aria-labelledby="studio-console-heading"
      className="overflow-hidden rounded-panel border border-studio-700/50 bg-studio-950 shadow-e-1 animate-rise"
    >
      <div className="flex items-center justify-between gap-3 border-b border-studio-800 px-4 py-3 sm:px-5">
        <h2 id="studio-console-heading" className="flex items-center gap-2.5 text-micro font-semibold uppercase text-studio-200">
          <LevelMeter bars={4} className="h-3 text-studio-300" />
          Studio console
        </h2>
        <span className="flex items-center gap-1.5 text-micro font-semibold uppercase text-success-300">
          <span aria-hidden="true" className="h-1.5 w-1.5 animate-breathe rounded-full bg-current" />
          Live
        </span>
      </div>

      {progressLog.length === 0 ? (
        <div className="px-4 py-4 sm:px-5">
          <p className="font-mono text-caption italic text-studio-300">
            {bookStatus === "discovering" ? "Starting up — acquisition and parsing updates land here shortly…" : "Waiting for cues…"}
          </p>
          <ProgressBar progress={0} indeterminate tone="studio" thickness="hairline" label="Waiting for studio updates" className="mt-3" />
        </div>
      ) : (
        <ol
          role="log"
          aria-live="polite"
          aria-label="Studio updates, newest first"
          className="scroll-quiet max-h-44 space-y-1 overflow-y-auto px-4 py-3 font-mono text-caption sm:px-5"
        >
          {progressLog.map((log, index) => (
            <li key={log.id} className={`flex gap-2.5 ${index === 0 ? "" : "opacity-70"}`}>
              <span aria-hidden="true" className="select-none text-studio-500">
                ›
              </span>
              <span className={`min-w-0 break-words ${logToneClass(log.text) ?? (index === 0 ? "text-studio-50" : "text-studio-200")}`}>
                {log.text}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function logToneClass(text: string): string | undefined {
  if (/fail|error|quota|⛔|❌/i.test(text)) return "text-danger-300";
  if (/warn|⚠️/i.test(text)) return "text-warning-300";
  return undefined;
}
