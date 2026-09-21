export interface AuthFieldProps {
  id: string;
  label: string;
  type: "email" | "password";
  value: string;
  placeholder: string;
  autoComplete: string;
  describedBy?: string;
  error?: string;
  help?: string;
  inputMode?: "email";
  autoFocus?: boolean;
  minLength?: number;
  maxLength?: number;
  onChange: (value: string) => void;
}

export function AuthField({
  id,
  label,
  type,
  value,
  placeholder,
  autoComplete,
  describedBy,
  error,
  help,
  inputMode,
  autoFocus,
  minLength,
  maxLength,
  onChange,
}: AuthFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="label-caps mb-2 block text-cinema-300">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        required
        autoFocus={autoFocus}
        minLength={minLength}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        className="input-field"
        placeholder={placeholder}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-2 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : help ? (
        <p id={`${id}-help`} className="mt-2 text-[11px] text-cinema-500">
          {help}
        </p>
      ) : null}
    </div>
  );
}
