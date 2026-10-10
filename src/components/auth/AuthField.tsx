import { useState, type KeyboardEvent } from "react";
import { Icon, IconButton, TextField } from "../ui";

interface AuthFieldProps {
  id: string;
  label: string;
  type: "email" | "password";
  value: string;
  placeholder: string;
  autoComplete: string;
  error?: string;
  help?: string;
  inputMode?: "email";
  autoFocus?: boolean;
  minLength?: number;
  maxLength?: number;
  readOnly?: boolean;
  onChange: (value: string) => void;
}

export function AuthField({
  id,
  label,
  type,
  value,
  placeholder,
  autoComplete,
  error,
  help,
  inputMode,
  autoFocus,
  minLength,
  maxLength,
  readOnly,
  onChange,
}: AuthFieldProps) {
  const isPassword = type === "password";
  const [revealed, setRevealed] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const trackCapsLock = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isPassword) setCapsLock(event.getModifierState("CapsLock"));
  };

  return (
    <div>
      <TextField
        id={id}
        name={id}
        label={label}
        type={isPassword && revealed ? "text" : type}
        leadingIcon={isPassword ? "lock" : "mail"}
        autoComplete={autoComplete}
        inputMode={inputMode}
        autoCapitalize="none"
        spellCheck={false}
        required
        autoFocus={autoFocus}
        minLength={minLength}
        maxLength={maxLength}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        error={error}
        help={help}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={trackCapsLock}
        onKeyUp={trackCapsLock}
        onBlur={() => setCapsLock(false)}
        hint={
          capsLock ? (
            <span className="flex items-center gap-1 text-warning-300" aria-hidden="true">
              <Icon name="alert" size={14} />
              Caps Lock is on
            </span>
          ) : undefined
        }
        trailing={
          isPassword ? (
            <IconButton
              icon={revealed ? "eyeOff" : "eye"}
              label="Show password"
              aria-pressed={revealed}
              aria-controls={id}
              size="sm"
              onClick={() => setRevealed((current) => !current)}
            />
          ) : undefined
        }
      />
      {isPassword && (
        <span className="sr-only" role="status">
          {capsLock ? "Caps Lock is on" : ""}
        </span>
      )}
    </div>
  );
}
