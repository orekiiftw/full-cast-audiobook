type Severity = "ok" | "warn" | "error";

interface EnvCheck {
  variable: string;
  severity: Severity;
  absent: string;
  present?: string | ((value: string) => string);
}

const ENV_CHECKS: EnvCheck[] = [
  {
    variable: "GEMINI_API_KEY",
    severity: "error",
    present: "Gemini API Key is configured (annotation).",
    absent: "CRITICAL WARNING: GEMINI_API_KEY environment variable is not set! Beat annotation will fail.",
  },
  {
    variable: "GEMINI_TEXT_MODEL",
    severity: "warn",
    present: (value) => `Text Model configured: ${value}`,
    absent: "GEMINI_TEXT_MODEL is not set. Defaulting to model fallback.",
  },
  {
    variable: "MIMO_API_KEY",
    severity: "error",
    present: "MiMo API Key is configured (TTS).",
    absent: "CRITICAL WARNING: MIMO_API_KEY environment variable is not set! TTS synthesis will fail.",
  },
  {
    variable: "MIMO_TS_MODEL",
    severity: "warn",
    present: (value) => `TTS Model configured: ${value}`,
    absent: "MIMO_TS_MODEL is not set. Defaulting to model fallback.",
  },
  {
    variable: "SARVAM_API_KEY",
    severity: "warn",
    present: () => `Sarvam API Key is configured (Hindi/Indic TTS, model: ${process.env.SARVAM_TS_MODEL || "bulbul:v3"}).`,
    absent: "SARVAM_API_KEY is not set. Hindi/Indic books will fall back to MiMo, which cannot pronounce them.",
  },
  {
    variable: "TORBOX_API_KEY",
    severity: "warn",
    absent: "TORBOX_API_KEY is not set. Torrent download service will be unavailable.",
  },
  {
    variable: "DATABASE_URL",
    severity: "warn",
    absent: "DATABASE_URL is not set. Using local postgres default.",
  },
  {
    variable: "REDIS_URL",
    severity: "warn",
    absent: "REDIS_URL is not set. Using redis://127.0.0.1:6379 (the pipeline queue requires Redis).",
  },
];

const LOGGER = {
  ok: (message: string) => console.log(`✅ ${message}`),
  warn: (message: string) => console.warn(`⚠️ ${message}`),
  error: (message: string) => console.error(`❌ ${message}`),
} satisfies Record<Severity, (message: string) => void>;

export function reportEnvironment(): void {
  console.log("🛠️ Starting System Checks...");
  for (const check of ENV_CHECKS) {
    const value = process.env[check.variable];
    if (!value) {
      LOGGER[check.severity](check.absent);
      continue;
    }
    if (!check.present) continue;
    LOGGER.ok(typeof check.present === "function" ? check.present(value) : check.present);
  }
  reportSecurityPosture();
}

function reportSecurityPosture(): void {
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && process.env.REGISTRATION_ENABLED === "true") {
    LOGGER.error(
      "SECURITY: REGISTRATION_ENABLED=true in production — anyone with network access can create accounts and spend your TTS/LLM quota. " +
        "Create your account(s) then unset REGISTRATION_ENABLED (or set false) and redeploy.",
    );
  }

  if (process.env.INSECURE_HTTP === "true") {
    if (isProduction) {
      LOGGER.warn(
        "INSECURE_HTTP=true: session cookies will NOT carry the Secure flag. " +
          "Only use this on trusted plain-HTTP networks (e.g. LAN); never on the public internet.",
      );
    }
    return;
  }

  if (isProduction) {
    console.log("🔒 Session cookies are Secure-only (HTTPS required). Set INSECURE_HTTP=true for plain-HTTP deployments.");
  }
}
