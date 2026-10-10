import { Button, Card, Icon, TextField } from "../ui";
import type { PronunciationFormModel } from "./usePronunciationForm";
import type { PronunciationTerm } from "../../types/api";

interface PronunciationEditorProps {
  terms: PronunciationTerm[];
  form: PronunciationFormModel;
}

export function PronunciationEditor({ terms, form }: PronunciationEditorProps) {
  return (
    <section aria-labelledby="dictionary-heading" className="min-w-0">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-line-hairline pb-3">
        <h2 id="dictionary-heading" className="font-serif text-title-lg font-medium text-ink-primary">
          Phonetic dictionary
        </h2>
        {terms.length > 0 && (
          <span className="eyebrow tabular-nums">
            {terms.length} {terms.length === 1 ? "guide" : "guides"}
          </span>
        )}
      </div>

      <Card className="p-5 sm:p-6">
        <p className="text-caption text-ink-secondary">
          Guide how names and invented words should sound. Hints are woven into the performance prompts.
        </p>

        {terms.length > 0 ? (
          <TermList terms={terms} />
        ) : (
          <p className="mt-4 rounded-tile border border-dashed border-line-strong px-4 py-3 text-caption text-ink-tertiary">
            No guides yet. Add a name the narrator might stumble over.
          </p>
        )}

        <PronunciationForm form={form} />
      </Card>
    </section>
  );
}

function TermList({ terms }: { terms: PronunciationTerm[] }) {
  return (
    <dl className="scroll-quiet mt-4 max-h-72 divide-y divide-line-hairline overflow-y-auto rounded-tile border border-line-hairline bg-surface-1">
      {terms.map((term) => (
        <div key={term.id} className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
          <dt className="break-words font-serif text-body-lg text-ink-primary">{term.term}</dt>
          <dd className="break-words font-mono text-caption text-gold-200">{term.phoneticHint}</dd>
        </div>
      ))}
    </dl>
  );
}

function PronunciationForm({ form }: { form: PronunciationFormModel }) {
  const term = form.term.trim();
  const hint = form.hint.trim();

  return (
    <form
      onSubmit={form.submit}
      aria-busy={form.adding || undefined}
      className="mt-6 flex w-full min-w-0 flex-col gap-4 border-t border-line-hairline pt-5"
    >
      <p className="eyebrow">Add a guide</p>
      <TextField
        id="pronunciation-term"
        label="Term"
        type="text"
        required
        maxLength={200}
        autoComplete="off"
        placeholder="e.g. Cthulhu"
        value={form.term}
        readOnly={form.adding}
        onChange={(event) => form.setTerm(event.target.value)}
      />
      <TextField
        id="pronunciation-hint"
        label="Pronunciation hint"
        type="text"
        required
        maxLength={200}
        autoComplete="off"
        spellCheck={false}
        placeholder="e.g. kuh-THOO-loo"
        value={form.hint}
        readOnly={form.adding}
        onChange={(event) => form.setHint(event.target.value)}
        inputClassName="font-mono"
      />

      {term && hint && (
        <p className="flex items-start gap-2 rounded-tile border border-line-accent bg-gold-500/10 px-3.5 py-2.5 text-caption text-ink-secondary">
          <Icon name="waveform" size={16} className="mt-px shrink-0 text-gold-300" />
          <span className="min-w-0 break-words">
            The narrator will say <span className="font-serif text-ink-primary">{term}</span> as{" "}
            <span className="font-mono text-gold-200">{hint}</span>
            <span className="ml-2 text-micro font-semibold uppercase text-ink-tertiary">Unsaved</span>
          </span>
        </p>
      )}

      <Button type="submit" variant="secondary" className="w-full" isLoading={form.adding}>
        {!form.adding && <Icon name="plus" size={16} />}
        {form.adding ? "Saving…" : "Add pronunciation"}
      </Button>
    </form>
  );
}
