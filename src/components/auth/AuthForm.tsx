import { Button } from "../ui";
import { AuthField } from "./AuthField";
import type { AuthFormModel } from "./useAuthForm";

export function AuthForm({ form }: { form: AuthFormModel }) {
  return (
    <form className="mt-6 space-y-5" onSubmit={form.submit} noValidate>
      <EmailField form={form} />
      <PasswordField form={form} />

      {form.formError && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/35 px-3.5 py-3 text-xs leading-relaxed text-red-200" role="alert">
          {form.formError}
        </div>
      )}

      <Button type="submit" variant="primary" size="lg" isLoading={form.submitting} className="w-full">
        {form.submitting ? (form.isLogin ? "Signing in…" : "Creating account…") : form.isLogin ? "Sign in" : "Create account"}
      </Button>
    </form>
  );
}

function EmailField({ form }: { form: AuthFormModel }) {
  return (
    <AuthField
      id="auth-email"
      label="Email address"
      type="email"
      value={form.email}
      placeholder="you@example.com"
      autoComplete="email"
      inputMode="email"
      autoFocus
      describedBy={form.fieldErrors.email ? "auth-email-error" : undefined}
      error={form.fieldErrors.email}
      onChange={form.changeEmail}
    />
  );
}

function PasswordField({ form }: { form: AuthFormModel }) {
  return (
    <AuthField
      id="auth-password"
      label="Password"
      type="password"
      value={form.password}
      placeholder="At least 12 characters"
      autoComplete={form.isLogin ? "current-password" : "new-password"}
      minLength={12}
      maxLength={128}
      describedBy={form.fieldErrors.password ? "auth-password-error" : "auth-password-help"}
      error={form.fieldErrors.password}
      help={form.isLogin ? undefined : "Use 12–128 characters."}
      onChange={form.changePassword}
    />
  );
}
