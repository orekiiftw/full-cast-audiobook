import { SegmentedControl, type SegmentedOption } from "../ui";
import type { AuthMode } from "../../types/api";

const MODE_OPTIONS: ReadonlyArray<SegmentedOption<AuthMode>> = [
  { id: "login", label: "Sign in" },
  { id: "signup", label: "Create account" },
];

interface AuthModeTabsProps {
  mode: AuthMode;
  onSelect: (mode: AuthMode) => void;
  disabled?: boolean;
}

export function AuthModeTabs({ mode, onSelect, disabled = false }: AuthModeTabsProps) {
  return (
    <SegmentedControl
      options={MODE_OPTIONS}
      value={mode}
      onChange={onSelect}
      label="Authentication mode"
      idPrefix="auth-mode"
      disabled={disabled}
      className="mt-7"
    />
  );
}
