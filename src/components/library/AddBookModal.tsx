import { useRef, useState, type DragEvent } from "react";
import { Button, Icon, Modal, SegmentedControl, TextField } from "../ui";
import { ADD_MODES, isMagnetInput, type AddBookValues, type AddMode } from "./addBook";
import { CLASSICS } from "./classics";
import type { AddBookFormModel } from "./useAddBookForm";

const MODE_DESCRIPTIONS: Record<AddMode, string> = {
  search: "Name a book and Narratea looks for a DRM-free EPUB. Progress appears on the book’s page.",
  file: "Upload a DRM-free EPUB from your device. Narration starts as soon as it’s parsed.",
  magnet: "Paste a magnet link or info-hash for a torrent that contains an EPUB.",
};

export function AddBookModal({ form }: { form: AddBookFormModel }) {
  return (
    <Modal
      isOpen={form.isModalOpen}
      onClose={form.close}
      title="Add a book"
      eyebrow="New performance"
      description="Choose how Narratea should find your book."
    >
      <SegmentedControl
        options={ADD_MODES}
        value={form.mode}
        onChange={form.selectMode}
        label="How to add the book"
        idPrefix="add-mode"
        disabled={form.submitting}
      />

      <form
        onSubmit={form.submit}
        role="tabpanel"
        aria-labelledby={`add-mode-${form.mode}`}
        aria-busy={form.submitting || undefined}
        className="space-y-5"
      >
        <p className="text-caption text-ink-tertiary">{MODE_DESCRIPTIONS[form.mode]}</p>

        <AddBookFields mode={form.mode} values={form.values} locked={form.submitting} onChange={form.updateValues} />

        <div className="flex flex-col-reverse gap-3 border-t border-line-hairline pt-5 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={form.close} disabled={form.submitting} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={form.submitting} className="w-full sm:w-auto">
            {form.submitting ? "Queuing…" : "Start performance"}
            {!form.submitting && <Icon name="arrowRight" size={16} />}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface AddBookFieldsProps {
  mode: AddMode;
  values: AddBookValues;
  locked: boolean;
  onChange: (patch: Partial<AddBookValues>) => void;
}

function AddBookFields({ mode, values, locked, onChange }: AddBookFieldsProps) {
  if (mode === "file") return <EpubDropzone file={values.file} locked={locked} onChange={(file) => onChange({ file })} />;

  if (mode === "magnet") {
    const magnet = values.magnet.trim();
    const looksValid = isMagnetInput(magnet);
    return (
      <TextField
        id="add-book-magnet"
        label="Magnet link or info-hash"
        leadingIcon="link"
        type="text"
        required
        maxLength={2048}
        autoComplete="off"
        spellCheck={false}
        value={values.magnet}
        readOnly={locked}
        onChange={(event) => onChange({ magnet: event.target.value })}
        placeholder="magnet:?xt=urn:btih:…"
        inputClassName="font-mono text-caption"
        help={
          !magnet ? (
            "Starts with magnet:?xt=urn:btih: or is 40 hexadecimal characters."
          ) : looksValid ? (
            <span className="flex items-center gap-1.5 text-success-300">
              <Icon name="checkCircle" size={14} />
              Looks like a valid magnet link.
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-warning-300">
              <Icon name="alert" size={14} />
              This doesn’t look like a magnet link or info-hash yet.
            </span>
          )
        }
      />
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="add-book-title"
          label="Title"
          leadingIcon="book"
          type="text"
          required
          maxLength={500}
          autoComplete="off"
          value={values.title}
          readOnly={locked}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder="e.g. Dracula"
        />
        <TextField
          id="add-book-author"
          label="Author"
          leadingIcon="pen"
          type="text"
          required
          maxLength={500}
          autoComplete="off"
          value={values.author}
          readOnly={locked}
          onChange={(event) => onChange({ author: event.target.value })}
          placeholder="e.g. Bram Stoker"
        />
      </div>
      <div>
        <p className="eyebrow mb-2" id="add-book-classics">
          Or try a classic
        </p>
        <ul role="list" aria-labelledby="add-book-classics" className="flex flex-wrap gap-2">
          {CLASSICS.map((classic) => {
            const selected = values.title === classic.title && values.author === classic.author;
            return (
              <li key={classic.title}>
                <button
                  type="button"
                  aria-pressed={selected}
                  disabled={locked}
                  onClick={() => onChange({ title: classic.title, author: classic.author })}
                  className={`touch-target flex h-8 items-center gap-1.5 rounded-full border px-3 text-caption transition-colors duration-fast ease-standard disabled:opacity-60 ${
                    selected
                      ? "border-line-accent bg-gold-500/10 text-gold-200"
                      : "border-line-strong bg-surface-3 text-ink-secondary enabled:hover:border-line-control enabled:hover:text-ink-primary"
                  }`}
                >
                  {selected && <Icon name="check" size={14} />}
                  <span className="font-serif italic">{classic.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

interface EpubDropzoneProps {
  file: File | null;
  locked: boolean;
  onChange: (file: File | null) => void;
}

function EpubDropzone({ file, locked, onChange }: EpubDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    if (locked) return;
    event.preventDefault();
    setDragging(true);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (locked) return;
    const dropped = event.dataTransfer.files;
    if (!dropped.length) return;
    // Mirror the dropped file onto the input so native `required` validation stays accurate.
    if (inputRef.current) inputRef.current.files = dropped;
    onChange(dropped[0] ?? null);
  };

  return (
    <label
      htmlFor="add-book-file"
      onDragOver={handleDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={handleDrop}
      className={`flex cursor-pointer flex-col items-center gap-3 rounded-panel border border-dashed px-5 py-8 text-center transition-colors duration-base ease-standard focus-within:border-gold-400 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gold-400 ${
        dragging
          ? "border-gold-400 bg-gold-500/10"
          : file
            ? "border-line-accent bg-surface-1"
            : "border-line-control bg-surface-1 hover:bg-surface-3"
      }`}
    >
      <input
        ref={inputRef}
        id="add-book-file"
        type="file"
        required
        accept=".epub"
        disabled={locked}
        onChange={(event) => onChange(event.target.files?.[0] || null)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`flex h-12 w-12 items-center justify-center rounded-tile border shadow-e-1 ${
          file ? "border-line-accent bg-gold-500/10 text-gold-300" : "border-line-strong bg-surface-3 text-ink-secondary"
        }`}
      >
        <Icon name={file ? "book" : "upload"} size={22} />
      </span>
      {file ? (
        <span className="min-w-0 max-w-full">
          <span className="block truncate font-medium text-ink-primary">{file.name}</span>
          <span className="mt-0.5 block text-caption text-ink-tertiary">
            {formatFileSize(file.size)} · <span className="text-gold-300">Choose a different file</span>
          </span>
        </span>
      ) : (
        <span>
          <span className="block font-medium text-ink-primary">
            Drop an EPUB here, or <span className="text-gold-300 underline underline-offset-4">browse</span>
          </span>
          <span className="mt-0.5 block text-caption text-ink-tertiary">DRM-free .epub files only</span>
        </span>
      )}
    </label>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
