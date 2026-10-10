import { Icon, Notice } from "../ui";
import { AuthForm } from "./AuthForm";
import { AuthModeTabs } from "./AuthModeTabs";
import type { AuthFormModel } from "./useAuthForm";

interface AuthCardProps {
  form: AuthFormModel;
  sessionExpired: boolean;
}

const CARD_DELAY = { animationDelay: "80ms" };

export function AuthCard({ form, sessionExpired }: AuthCardProps) {
  return (
    <section className="w-full max-w-md animate-rise lg:justify-self-end" style={CARD_DELAY} aria-labelledby="auth-title">
      <div className="relative overflow-hidden rounded-stage border border-line-strong bg-surface-1 p-6 shadow-e-3 sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold-300/60 to-transparent"
        />

        <AuthHeading isLogin={form.isLogin} />
        <AuthModeTabs mode={form.mode} onSelect={form.changeMode} disabled={form.submitting} />

        {sessionExpired && !form.formError && (
          <Notice tone="gold" icon="clock" role="status" className="mt-5">
            Your session ended. Sign in again to return to your library.
          </Notice>
        )}

        <div role="tabpanel" aria-labelledby={`auth-mode-${form.mode}`}>
          <AuthForm form={form} />
        </div>
      </div>

      <p className="mt-5 flex items-center justify-center gap-2 text-center text-caption text-ink-tertiary">
        <Icon name="lock" size={14} />
        Your session is secured with a same-origin cookie.
      </p>
    </section>
  );
}

function AuthHeading({ isLogin }: { isLogin: boolean }) {
  const title = isLogin ? "Enter your library" : "Create your account";
  const subtitle = isLogin ? "Sign in to continue your performances." : "Start building your private audio collection.";

  return (
    <header>
      <p className="eyebrow text-gold-400">{isLogin ? "Welcome back" : "Opening night"}</p>
      <h2 id="auth-title" className="mt-2 font-serif text-display-md font-medium text-ink-primary">
        {title}
      </h2>
      <p className="mt-2 text-body text-ink-secondary">{subtitle}</p>
    </header>
  );
}
