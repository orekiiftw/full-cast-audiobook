import { AuthCard, AuthIntro, useAuthForm } from "./auth";
import type { AuthUser } from "../types/api";

interface AuthScreenProps {
  onAuthenticated: (user: AuthUser) => void;
  sessionExpired?: boolean;
}

export function AuthScreen({ onAuthenticated, sessionExpired = false }: AuthScreenProps) {
  const form = useAuthForm(onAuthenticated);

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-surface-0 font-sans text-ink-primary">
      <div className="atmosphere -z-10" aria-hidden="true" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 hidden w-px bg-gradient-to-b from-transparent via-line-hairline to-transparent lg:block"
      />

      <div className="mx-auto grid min-h-screen w-full max-w-lg content-center items-center gap-10 px-5 py-10 sm:px-8 lg:max-w-6xl sm:py-14 lg:grid-cols-2 lg:gap-16 lg:py-16 xl:gap-24">
        <AuthIntro />
        <AuthCard form={form} sessionExpired={sessionExpired} />
      </div>
    </main>
  );
}
