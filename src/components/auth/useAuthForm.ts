import { useState } from "react";
import { apiFetch, authUserFromResponse, safeApiError } from "../../lib/api";
import type { AuthMode, AuthResponse, AuthUser } from "../../types/api";

interface FieldErrors {
  email?: string;
  password?: string;
}

export interface AuthFormModel {
  mode: AuthMode;
  isLogin: boolean;
  email: string;
  password: string;
  fieldErrors: FieldErrors;
  formError: string;
  submitting: boolean;
  changeMode: (mode: AuthMode) => void;
  changeEmail: (value: string) => void;
  changePassword: (value: string) => void;
  submit: (event: React.FormEvent<HTMLFormElement>) => void;
}

export function useAuthForm(onAuthenticated: (user: AuthUser) => void): AuthFormModel {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === "login";

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setFieldErrors({});
    setFormError("");
  };

  const changeEmail = (value: string) => {
    setEmail(value);
    if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined }));
  };

  const changePassword = (value: string) => {
    setPassword(value);
    if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: undefined }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const errors = validate(email, password);
    setFieldErrors(errors);
    setFormError("");
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const response = await apiFetch(
        `/api/auth/${mode}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        },
        { notifyOnUnauthorized: false },
      );

      if (!response.ok) {
        setFormError(await safeApiError(response, isLogin ? "Unable to sign in." : "Unable to create your account."));
        return;
      }

      const payload = (await response.json()) as AuthResponse | AuthUser;
      const user = authUserFromResponse(payload);
      if (!user) {
        setFormError("Your account was accepted, but the session response was invalid. Please try again.");
        return;
      }
      onAuthenticated(user);
    } catch (error) {
      console.error("Authentication request failed:", error);
      setFormError("We couldn’t reach Narratea. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return {
    mode,
    isLogin,
    email,
    password,
    fieldErrors,
    formError,
    submitting,
    changeMode,
    changeEmail,
    changePassword,
    submit,
  };
}

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  const cleanEmail = email.trim();
  if (!cleanEmail) {
    errors.email = "Enter your email address.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    errors.email = "Enter a valid email address.";
  }
  if (!password) {
    errors.password = "Enter your password.";
  } else if (password.length < 12) {
    errors.password = "Password must be at least 12 characters.";
  }
  return errors;
}
