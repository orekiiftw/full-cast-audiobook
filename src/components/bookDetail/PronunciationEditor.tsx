import { Button, Card } from "../ui";
import type { PronunciationFormModel } from "./usePronunciationForm";
import type { PronunciationTerm } from "../../types/api";

interface PronunciationEditorProps {
  terms: PronunciationTerm[];
  form: PronunciationFormModel;
}

export function PronunciationEditor({ terms, form }: PronunciationEditorProps) {
  return (
    <section aria-labelledby="dictionary-heading" className="min-w-0">
      <Card className="p-5 sm:p-6">
        <p className="label-caps mb-3 text-gold-300">The finer details</p>
        <h2 id="dictionary-heading" className="mb-3 font-serif text-2xl font-medium tracking-tight text-gold-50">
          Phonetic dictionary
        </h2>
        <p className="mb-6 text-sm leading-relaxed text-cinema-300">
          Guide how names and invented words should sound. Hints are woven into the performance prompts.
        </p>

        {terms.length > 0 && <TermList terms={terms} />}

        <PronunciationForm form={form} />
      </Card>
    </section>
  );
}

function TermList({ terms }: { terms: PronunciationTerm[] }) {
  return (
    <dl className="mb-6 divide-y divide-cinema-700 border-y border-cinema-700">
      {terms.map((term) => (
        <div key={term.id} className="min-w-0 py-3">
          <dt className="break-words font-serif text-base text-cinema-100">{term.term}</dt>
          <dd className="mt-1 break-words font-mono text-xs leading-relaxed text-gold-300">{term.phoneticHint}</dd>
        </div>
      ))}
    </dl>
  );
}

function PronunciationForm({ form }: { form: PronunciationFormModel }) {
  return (
    <form onSubmit={form.submit} className="flex w-full min-w-0 flex-col gap-4">
      <label className="block min-w-0 text-sm text-cinema-200">
        <span className="mb-2 block">Term</span>
        <input
          type="text"
          required
          maxLength={200}
          placeholder="e.g. Cthulhu"
          value={form.term}
          onChange={(event) => form.setTerm(event.target.value)}
          className="input-field min-h-11 w-full min-w-0 !text-base"
        />
      </label>
      <label className="block min-w-0 text-sm text-cinema-200">
        <span className="mb-2 block">Pronunciation hint</span>
        <input
          type="text"
          required
          maxLength={200}
          placeholder="e.g. kuh-THOO-loo"
          value={form.hint}
          onChange={(event) => form.setHint(event.target.value)}
          className="input-field min-h-11 w-full min-w-0 !text-base"
        />
      </label>
      <Button type="submit" variant="secondary" size="sm" className="min-h-11 w-full" isLoading={form.adding}>
        Add pronunciation
      </Button>
    </form>
  );
}
