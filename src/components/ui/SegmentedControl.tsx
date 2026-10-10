import { useRef, type KeyboardEvent } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
}

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  idPrefix?: string;
  disabled?: boolean;
}

// Renders as an ARIA tablist with roving focus: arrow keys, Home and End move the selection.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className = "",
  idPrefix,
  disabled = false,
}: SegmentedControlProps<T>) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );

  const select = (index: number) => {
    const next = options[(index + options.length) % options.length];
    onChange(next.id);
    buttonsRef.current[(index + options.length) % options.length]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") select(selectedIndex + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") select(selectedIndex - 1);
    else if (event.key === "Home") select(0);
    else if (event.key === "End") select(options.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={`relative grid rounded-full border border-line-hairline bg-surface-0 p-1 shadow-inset transition-opacity duration-base ${
        disabled ? "opacity-60" : ""
      } ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 rounded-full border border-line-strong bg-surface-4 shadow-e-1 transition-transform duration-enter ease-out-expo"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${selectedIndex * 100}%)` }}
      />
      {options.map((option, index) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            ref={(element) => {
              buttonsRef.current[index] = element;
            }}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-${option.id}` : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled && !selected}
            onClick={() => onChange(option.id)}
            className={`touch-target relative z-10 flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full px-3 text-caption font-semibold transition-colors duration-fast ease-standard ${
              selected ? "text-ink-primary" : "text-ink-tertiary enabled:hover:text-ink-primary"
            }`}
          >
            {option.icon && <Icon name={option.icon} size={16} className={selected ? "text-gold-300" : ""} />}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
