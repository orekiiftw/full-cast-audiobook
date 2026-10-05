import { Button, Icon, Modal } from "../ui";
import { ADD_MODES, type AddBookValues, type AddMode } from "./addBook";
import type { AddBookFormModel } from "./useAddBookForm";

export function AddBookModal({ form }: { form: AddBookFormModel }) {
  return (
    <Modal isOpen={form.isModalOpen} onClose={form.close} title="Add a book">
      <AddBookModeTabs mode={form.mode} onSelect={form.selectMode} />

      <form onSubmit={form.submit} className="space-y-4 pt-1">
        <AddBookFields mode={form.mode} values={form.values} onChange={form.updateValues} />

        <Button type="submit" variant="primary" isLoading={form.submitting} className="w-full !mt-6">
          {form.submitting ? "Queuing…" : "Start performance"}
        </Button>
      </form>
    </Modal>
  );
}

interface AddBookTextFieldProps {
  label: string;
  placeholder: string;
  maxLength: number;
  value: string;
  onChange: (value: string) => void;
}

function AddBookTextField({ label, placeholder, maxLength, value, onChange }: AddBookTextFieldProps) {
  return (
    <label className="block">
      <span className="label-caps mb-2 block">{label}</span>
      <input
        type="text"
        required
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="input-field"
      />
    </label>
  );
}

interface AddBookFieldsProps {
  mode: AddMode;
  values: AddBookValues;
  onChange: (patch: Partial<AddBookValues>) => void;
}

function AddBookFields({ mode, values, onChange }: AddBookFieldsProps) {
  return (
    <>
      {mode === "search" && (
        <>
          <AddBookTextField
            label="Title"
            placeholder="e.g. Dracula"
            maxLength={500}
            value={values.title}
            onChange={(title) => onChange({ title })}
          />
          <AddBookTextField
            label="Author"
            placeholder="e.g. Bram Stoker"
            maxLength={500}
            value={values.author}
            onChange={(author) => onChange({ author })}
          />
        </>
      )}

      {mode === "magnet" && (
        <AddBookTextField
          label="Magnet / hash"
          placeholder="magnet:?xt=urn:btih:…"
          maxLength={2048}
          value={values.magnet}
          onChange={(magnet) => onChange({ magnet })}
        />
      )}

      {mode === "file" && (
        <label className="block">
          <span className="label-caps mb-2 block">EPUB file</span>
          <input
            type="file"
            required
            accept=".epub"
            onChange={(event) => onChange({ file: event.target.files?.[0] || null })}
            className="input-field file:mr-3 file:rounded-lg file:border-0 file:bg-cinema-700 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-cinema-100 hover:file:bg-cinema-600"
          />
        </label>
      )}
    </>
  );
}

function AddBookModeTabs({ mode, onSelect }: { mode: AddMode; onSelect: (mode: AddMode) => void }) {
  return (
    <div className="flex gap-1 p-1 rounded-2xl bg-cinema-950/80 border border-white/[0.05]">
      {ADD_MODES.map((modeOption) => (
        <button
          key={modeOption.id}
          type="button"
          onClick={() => onSelect(modeOption.id)}
          className={`flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2.5 rounded-xl font-semibold transition-all duration-200 ${
            mode === modeOption.id
              ? "bg-gradient-to-b from-gold-400 to-gold-500 text-cinema-950 shadow-glow-sm"
              : "text-cinema-400 hover:text-white"
          }`}
        >
          <Icon name={modeOption.icon} size={14} />
          {modeOption.label}
        </button>
      ))}
    </div>
  );
}
