import { Button, Icon, Modal } from "../ui";

const DIRECTION_IDEAS = ["Whisper it", "With more fear", "Slower, with suppressed anger", "Warmer and amused"];

interface RegenerateLineModalProps {
  isOpen: boolean;
  instruction: string;
  isRegenerating: boolean;
  onInstructionChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function RegenerateLineModal({
  isOpen,
  instruction,
  isRegenerating,
  onInstructionChange,
  onClose,
  onSubmit,
}: RegenerateLineModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Redo this line"
      eyebrow="Direct the performance"
      description="Tell the narrator how this line should land. The new take replaces the old one."
    >
      <div>
        <label htmlFor="redo-instruction" className="mb-1.5 block text-caption font-medium text-ink-secondary">
          Direction
        </label>
        <textarea
          id="redo-instruction"
          rows={3}
          value={instruction}
          readOnly={isRegenerating}
          onChange={(event) => onInstructionChange(event.target.value)}
          placeholder="e.g. slower pace, with suppressed anger…"
          className="field min-h-24 resize-none leading-relaxed"
        />
      </div>

      <div>
        <p className="eyebrow mb-2" id="redo-ideas">
          Ideas
        </p>
        <ul role="list" aria-labelledby="redo-ideas" className="flex flex-wrap gap-2">
          {DIRECTION_IDEAS.map((idea) => (
            <li key={idea}>
              <button
                type="button"
                disabled={isRegenerating}
                onClick={() => onInstructionChange(idea.toLowerCase())}
                className="touch-target flex h-8 items-center rounded-full border border-line-strong bg-surface-3 px-3 font-serif text-caption italic text-ink-secondary transition-colors duration-fast enabled:hover:border-line-accent enabled:hover:text-ink-primary disabled:opacity-60"
              >
                {idea}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-line-hairline pt-5 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose} disabled={isRegenerating} className="w-full sm:w-auto">
          Cancel
        </Button>
        <Button variant="primary" onClick={onSubmit} isLoading={isRegenerating} className="w-full sm:w-auto">
          {!isRegenerating && <Icon name="microphone" size={16} />}
          {isRegenerating ? "Re-performing…" : "Perform line"}
        </Button>
      </div>
    </Modal>
  );
}
