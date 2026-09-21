import { AuthCard, AuthIntro, useAuthForm } from "./auth";
import type { AuthUser } from "../types/api";

interface AuthScreenProps {
  onAuthenticated: (user: AuthUser) => void;
  sessionExpired?: boolean;
}

export function AuthScreen({ onAuthenticated, sessionExpired = false }: AuthScreenProps) {
  const form = useAuthForm(onAuthenticated);

  return (
    <main className="auth-shell grainy min-h-screen text-cinema-100 font-sans">
      <div className="auth-orb auth-orb--gold" aria-hidden="true" />
      <div className="auth-orb auth-orb--violet" aria-hidden="true" />

      <div className="relative z-10 mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-5 py-10 sm:px-6 lg:grid-cols-[1.08fr_0.92fr] lg:gap-20 lg:py-16">
        <AuthIntro />
        <AuthCard form={form} sessionExpired={sessionExpired} />
      </div>
    </main>
  );
}
