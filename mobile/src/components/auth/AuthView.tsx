import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { ApiError } from "@/api/client";
import { AppText, Button, Eyebrow, Notice, Screen, SegmentedControl, TextField } from "@/components/ui";
import { useAuth } from "@/auth/AuthProvider";
import { colors, elevation, radius } from "@/theme/tokens";

type Mode = "login" | "signup";

// Auth parity with `src/components/auth/*`: one card, two modes, inline errors, and the
// "session expired" notice when a dead token dropped the user back here.
export function AuthView() {
  const { signIn, createAccount, sessionExpired } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (submitting) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (mode === "login") await signIn(email, password);
      else await createAccount(email, password);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not reach the server. Check the API address.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <Eyebrow>Narratea</Eyebrow>
        <AppText variant="displayLg">The Listening Room</AppText>
        <AppText variant="body" tone="secondary" style={styles.lede}>
          Ebooks performed line by line by a cast of AI voices. Sign in to pick up your library.
        </AppText>
      </View>

      <View style={[styles.card, elevation.e2]}>
        <SegmentedControl
          options={[
            { id: "login", label: "Sign in" },
            { id: "signup", label: "Create account" },
          ]}
          value={mode}
          onChange={setMode}
        />

        {sessionExpired ? <Notice message="Your session expired. Sign in again to continue." /> : null}

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          placeholder="you@example.com"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          textContentType={mode === "login" ? "password" : "newPassword"}
          placeholder={mode === "signup" ? "At least 12 characters" : "Your password"}
          onSubmitEditing={() => void submit()}
          returnKeyType="go"
        />

        {error ? <Notice tone="error" message={error} /> : null}

        <Button
          label={mode === "login" ? "Sign in" : "Create account"}
          icon={mode === "login" ? "log-in" : "user-plus"}
          size="lg"
          loading={submitting}
          onPress={() => void submit()}
        />
        <AppText variant="caption" tone="tertiary" center>
          {mode === "signup"
            ? "Signups only work when the server has registration enabled."
            : "One account keeps your library and listening position in sync."}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 8, paddingTop: 48, marginBottom: 28 },
  lede: { maxWidth: 360 },
  card: {
    gap: 16,
    borderRadius: radius.stage,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.hairline,
    backgroundColor: colors.surface[1],
    padding: 20,
  },
});
