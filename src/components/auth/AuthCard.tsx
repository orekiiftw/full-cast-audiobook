import { BrandLogo } from "../ui";
import { AuthForm } from "./AuthForm";
import { AuthModeTabs } from "./AuthModeTabs";
import type { AuthFormModel } from "./useAuthForm";

interface AuthCardProps {
  form: AuthFormModel;
  sessionExpired: boolean;
}

export function AuthCard({ form, sessionExpired }: AuthCardProps) {
  return (
    <section className="mx-auto w-full max-w-md animate-fade-up" aria-labelledby="auth-title">
      <BrandLogo size="md" className="mb-8 justify-center lg:hidden" />

      <div className="glass-strong relative overflow-hidden rounded-[2rem] p-6 shadow-elevated sm:p-8">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold-300/50 to-transparent" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-48 w-48 rounded-full bg-gold-500/[0.08] blur-3xl" />

        <div className="relative">
          <AuthHeading isLogin={form.isLogin} />
          <AuthModeTabs mode={form.mode} onSelect={form.changeMode} />

          {sessionExpired && !form.formError && (
            <div
              className="mt-5 rounded-xl border border-gold-500/20 bg-gold-500/[0.07] px-3.5 py-3 text-xs leading-relaxed text-gold-200"
              role="status"
            >
              Your session ended. Sign in again to return to your library.
            </div>
          )}

          <AuthForm form={form} />
        </div>
      </div>

      <p className="mt-5 text-center text-[11px] leading-relaxed text-cinema-500">Your session is secured with a same-origin cookie.</p>
    </section>
  );
}

function AuthHeading({ isLogin }: { isLogin: boolean }) {
  const title = isLogin ? "Enter your library" : "Create your account";
  const subtitle = isLogin ? "Sign in to continue your performances." : "Start building your private audio collection.";

  return (
    <>
      <p className="label-caps mb-3 text-gold-400">{isLogin ? "Welcome back" : "Opening night"}</p>
      <h2 id="auth-title" className="font-serif text-3xl font-medium tracking-tight text-gradient">
        {title}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-cinema-400">{subtitle}</p>
    </>
  );
}
