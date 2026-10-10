import { Button, Icon, Notice } from "../ui";
import { AuthField } from "./AuthField";
import type { AuthFormModel } from "./useAuthForm";

const REGISTRATION_CLOSED = /registration is disabled/i;
const RATE_LIMITED = /too many attempts/i;

export function AuthForm({ form }: { form: AuthFormModel }) {
  const submitLabel = form.submitting ? (form.isLogin ? "Signing in…" : "Creating account…") : form.isLogin ? "Sign in" : "Create account";

  return (
    <form className="mt-6 space-y-5" onSubmit={form.submit} noValidate aria-busy={form.submitting || undefined}>
      <EmailField form={form} />
      <PasswordField form={form} />

      {form.formError && <FormError form={form} />}

      <Button type="submit" variant="primary" size="lg" isLoading={form.submitting} className="w-full">
        {submitLabel}
        {!form.submitting && <Icon name="arrowRight" size={18} />}
      </Button>
    </form>
  );
}

function FormError({ form }: { form: AuthFormModel }) {
  if (!form.isLogin && REGISTRATION_CLOSED.test(form.formError)) {
    return (
      <Notice
        tone="info"
        icon="lock"
        role="status"
        title="Registration is closed"
        action={
          <Button size="sm" onClick={() => form.changeMode("login")}>
            Sign in instead
          </Button>
        }
      >
        This Narratea isn’t accepting new accounts right now. If you already have one, sign in to reach your library.
      </Notice>
    );
  }
  if (RATE_LIMITED.test(form.formError)) {
    return (
      <Notice tone="warning" icon="clock" role="alert" title="Take a short pause">
        {form.formError}
      </Notice>
    );
  }
  return (
    <Notice tone="danger" role="alert">
      {form.formError}
    </Notice>
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
      readOnly={form.submitting}
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
      placeholder={form.isLogin ? "Your password" : "At least 12 characters"}
      autoComplete={form.isLogin ? "current-password" : "new-password"}
      minLength={12}
      maxLength={128}
      readOnly={form.submitting}
      error={form.fieldErrors.password}
      help={form.isLogin ? undefined : "Use 12–128 characters."}
      onChange={form.changePassword}
    />
  );
}
