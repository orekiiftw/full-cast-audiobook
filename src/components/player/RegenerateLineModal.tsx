import { Button, Modal } from "../ui";

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
    <Modal isOpen={isOpen} onClose={onClose} title="Redo this line">
      <p className="text-xs text-cinema-400 leading-relaxed">
        Direct the performance — e.g. <span className="italic text-cinema-300">“whisper this, with more fear”</span>.
      </p>
      <textarea
        rows={3}
        value={instruction}
        onChange={(event) => onInstructionChange(event.target.value)}
        placeholder="e.g. slower pace, with suppressed anger…"
        className="input-field resize-none !text-xs min-h-[5rem]"
      />
      <Button variant="primary" className="w-full" onClick={onSubmit} isLoading={isRegenerating}>
        {isRegenerating ? "Re-performing…" : "Perform line"}
      </Button>
    </Modal>
  );
}
