import type { InputHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> {
  id: string;
  label: string;
  error?: string;
  help?: ReactNode;
  hint?: ReactNode;
  leadingIcon?: IconName;
  trailing?: ReactNode;
  className?: string;
  inputClassName?: string;
}

export function TextField({
  id,
  label,
  error,
  help,
  hint,
  leadingIcon,
  trailing,
  className = "",
  inputClassName = "",
  ...inputProps
}: TextFieldProps) {
  const messageId = error ? `${id}-error` : help ? `${id}-help` : undefined;

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-caption font-medium text-ink-secondary">
          {label}
        </label>
        {hint && <span className="text-caption text-ink-tertiary">{hint}</span>}
      </div>
      <div className="relative">
        {leadingIcon && (
          <Icon name={leadingIcon} size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
        )}
        <input
          {...inputProps}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={inputProps["aria-describedby"] ?? messageId}
          className={`field ${leadingIcon ? "pl-11" : ""} ${trailing ? "pr-12" : ""} ${inputClassName}`}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      <FieldMessage id={messageId} error={error} help={help} />
    </div>
  );
}

interface FieldMessageProps {
  id?: string;
  error?: string;
  help?: ReactNode;
}

export function FieldMessage({ id, error, help }: FieldMessageProps) {
  if (error) {
    return (
      <p id={id} className="mt-1.5 flex items-start gap-1.5 text-caption text-danger-300" role="alert">
        <Icon name="alert" size={14} className="mt-0.5" />
        <span>{error}</span>
      </p>
    );
  }
  if (help) {
    return (
      <p id={id} className="mt-1.5 text-caption text-ink-tertiary">
        {help}
      </p>
    );
  }
  return null;
}
