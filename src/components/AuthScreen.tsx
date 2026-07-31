import { useState } from "react";
import { apiFetch, authUserFromResponse, safeApiError } from "../lib/api";
import type { AuthMode, AuthResponse, AuthUser } from "../types/api";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

interface AuthScreenProps {
  onAuthenticated: (user: AuthUser) => void;
  sessionExpired?: boolean;
}

interface FieldErrors {
  email?: string;
  password?: string;
}

export default function AuthScreen({ onAuthenticated, sessionExpired = false }: AuthScreenProps) {
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

  const validate = (): FieldErrors => {
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
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const errors = validate();
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
        { notifyOnUnauthorized: false }
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

  return (
    <main className="auth-shell grainy min-h-screen text-cinema-100 font-sans">
      <div className="auth-orb auth-orb--gold" aria-hidden="true" />
      <div className="auth-orb auth-orb--violet" aria-hidden="true" />

      <div className="relative z-10 mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-5 py-10 sm:px-6 lg:grid-cols-[1.08fr_0.92fr] lg:gap-20 lg:py-16">
        <section className="hidden lg:block animate-fade-up" aria-labelledby="auth-intro-title">
          <div className="mb-10 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-300 via-gold-500 to-gold-700 shadow-glow-sm">
              <Icon name="sparkle" size={18} className="text-cinema-950" />
            </span>
            <span className="font-display text-base font-semibold uppercase tracking-[0.24em] text-gradient">
              Narratea
            </span>
          </div>
          <p className="label-caps mb-5 text-gold-400">Your private listening room</p>
          <h1 id="auth-intro-title" className="max-w-xl font-serif text-5xl font-medium leading-[1.06] tracking-tight text-gradient xl:text-6xl">
            Every story, performed.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-cinema-400">
            Upload a DRM-free EPUB and let one warm narrator voice every character with director-guided emotion, chapter by chapter, as it is generated.
          </p>
          <div className="mt-10 flex items-center gap-4 text-xs text-cinema-400">
            <span className="h-px w-12 bg-gradient-to-r from-gold-400/70 to-transparent" />
            Private library · Seamless listening · Live studio
          </div>
        </section>

        <section className="mx-auto w-full max-w-md animate-fade-up" aria-labelledby="auth-title">
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-300 via-gold-500 to-gold-700 shadow-glow-sm">
              <Icon name="sparkle" size={17} className="text-cinema-950" />
            </span>
            <span className="font-display text-[15px] font-semibold uppercase tracking-[0.22em] text-gradient">
              Narratea
            </span>
          </div>

          <div className="glass-strong relative overflow-hidden rounded-[2rem] p-6 shadow-elevated sm:p-8">
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold-300/50 to-transparent" />
            <div className="pointer-events-none absolute -right-20 -top-24 h-48 w-48 rounded-full bg-gold-500/[0.08] blur-3xl" />

            <div className="relative">
              <p className="label-caps mb-3 text-gold-400">{isLogin ? "Welcome back" : "Opening night"}</p>
              <h2 id="auth-title" className="font-serif text-3xl font-medium tracking-tight text-gradient">
                {isLogin ? "Enter your library" : "Create your account"}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-cinema-400">
                {isLogin ? "Sign in to continue your performances." : "Start building your private audio collection."}
              </p>

              <div className="mt-7 grid grid-cols-2 gap-1 rounded-2xl border border-white/[0.05] bg-cinema-950/70 p-1" role="tablist" aria-label="Authentication mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isLogin}
                  onClick={() => changeMode("login")}
                  className={`rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${isLogin ? "bg-cinema-700/80 text-white shadow-sm" : "text-cinema-400 hover:text-cinema-200"}`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isLogin}
                  onClick={() => changeMode("signup")}
                  className={`rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${!isLogin ? "bg-cinema-700/80 text-white shadow-sm" : "text-cinema-400 hover:text-cinema-200"}`}
                >
                  Create account
                </button>
              </div>

              {sessionExpired && !formError && (
                <div className="mt-5 rounded-xl border border-gold-500/20 bg-gold-500/[0.07] px-3.5 py-3 text-xs leading-relaxed text-gold-200" role="status">
                  Your session ended. Sign in again to return to your library.
                </div>
              )}

              <form className="mt-6 space-y-5" onSubmit={handleSubmit} noValidate>
                <div>
                  <label htmlFor="auth-email" className="label-caps mb-2 block text-cinema-300">Email address</label>
                  <input
                    id="auth-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined }));
                    }}
                    aria-invalid={!!fieldErrors.email}
                    aria-describedby={fieldErrors.email ? "auth-email-error" : undefined}
                    className="input-field"
                    placeholder="you@example.com"
                  />
                  {fieldErrors.email && <p id="auth-email-error" className="mt-2 text-xs text-red-300" role="alert">{fieldErrors.email}</p>}
                </div>

                <div>
                  <label htmlFor="auth-password" className="label-caps mb-2 block text-cinema-300">Password</label>
                  <input
                    id="auth-password"
                    name="password"
                    type="password"
                    autoComplete={isLogin ? "current-password" : "new-password"}
                    required
                    minLength={12}
                    maxLength={128}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: undefined }));
                    }}
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby={fieldErrors.password ? "auth-password-error" : "auth-password-help"}
                    className="input-field"
                    placeholder="At least 12 characters"
                  />
                  {fieldErrors.password ? (
                    <p id="auth-password-error" className="mt-2 text-xs text-red-300" role="alert">{fieldErrors.password}</p>
                  ) : !isLogin ? (
                    <p id="auth-password-help" className="mt-2 text-[11px] text-cinema-500">Use 12–128 characters.</p>
                  ) : null}
                </div>

                {formError && (
                  <div className="rounded-xl border border-red-900/50 bg-red-950/35 px-3.5 py-3 text-xs leading-relaxed text-red-200" role="alert">
                    {formError}
                  </div>
                )}

                <Button type="submit" variant="primary" size="lg" isLoading={submitting} className="w-full">
                  {submitting ? (isLogin ? "Signing in…" : "Creating account…") : (isLogin ? "Sign in" : "Create account")}
                </Button>
              </form>
            </div>
          </div>
          <p className="mt-5 text-center text-[11px] leading-relaxed text-cinema-500">
            Your session is secured with a same-origin cookie.
          </p>
        </section>
      </div>
    </main>
  );
}
