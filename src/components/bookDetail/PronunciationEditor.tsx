import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import type { PronunciationTerm } from "../../types/api";

interface PronunciationEditorProps {
  pronList: PronunciationTerm[];
  newTerm: string;
  newHint: string;
  addingPron: boolean;
  onNewTermChange: (value: string) => void;
  onNewHintChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function PronunciationEditor({
  pronList,
  newTerm,
  newHint,
  addingPron,
  onNewTermChange,
  onNewHintChange,
  onSubmit,
}: PronunciationEditorProps) {
  return (
    <Card className="p-6 sm:p-7">
      <h2 className="font-serif text-xl font-medium tracking-tight mb-2">Phonetic dictionary</h2>
      <p className="text-xs text-cinema-400 mb-6 leading-relaxed max-w-lg">
        Guide how names and invented words should sound. Hints are woven into the performance prompts.
      </p>

      {pronList.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {pronList.map((p: PronunciationTerm) => (
            <span
              key={p.id}
              className="text-xs px-3 py-1.5 rounded-full bg-cinema-950/60 border border-white/[0.06] flex gap-2"
            >
              <span className="font-medium text-cinema-100">{p.term}</span>
              <span className="text-cinema-600">→</span>
              <span className="italic text-gold-400 font-mono">{p.phoneticHint}</span>
            </span>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          required
          maxLength={200}
          placeholder="Term (e.g. Cthulhu)"
          value={newTerm}
          onChange={(e) => onNewTermChange(e.target.value)}
          className="input-field flex-1 !text-xs"
        />
        <input
          type="text"
          required
          maxLength={200}
          placeholder="Hint (e.g. kuh-THOO-loo)"
          value={newHint}
          onChange={(e) => onNewHintChange(e.target.value)}
          className="input-field flex-1 !text-xs"
        />
        <Button type="submit" variant="secondary" size="sm" isLoading={addingPron}>
          Add
        </Button>
      </form>
    </Card>
  );
}
