import { Button, Icon } from "../ui";

export function LibraryHeader({ onAddBook }: { onAddBook: () => void }) {
  return (
    <div className="flex flex-wrap justify-between items-end gap-8 mb-14">
      <div className="max-w-xl">
        <p className="label-caps text-gold-400/90 mb-4">Your collection</p>
        <h1 className="font-serif text-4xl sm:text-5xl md:text-[3.25rem] font-medium tracking-tight text-gradient leading-[1.1]">
          Library
        </h1>
        <p className="text-cinema-400 text-[15px] mt-4 leading-relaxed max-w-md">
          Ebooks, performed. One warm narrator, directed line by line by AI emotion cues.
        </p>
      </div>
      <Button variant="primary" size="lg" onClick={onAddBook}>
        <Icon name="plus" size={16} />
        Add book
      </Button>
    </div>
  );
}
