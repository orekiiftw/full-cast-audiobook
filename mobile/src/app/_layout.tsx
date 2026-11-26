import { useEffect } from "react";
import { View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { DMSans_400Regular, DMSans_400Regular_Italic, DMSans_500Medium, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { Fraunces_400Regular, Fraunces_400Regular_Italic, Fraunces_500Medium, Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { PerfHud } from "@/components/dev/PerfHud";
import { ToastProvider } from "@/components/ui";
import { PlayerProvider } from "@/playback/PlayerProvider";
import { colors } from "@/theme/tokens";

SplashScreen.preventAutoHideAsync().catch(() => {
  // A second call after a fast refresh rejects; the splash is already held.
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_400Regular,
    Fraunces_400Regular_Italic,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    DMSans_400Regular,
    DMSans_400Regular_Italic,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <ToastProvider>
        <AuthProvider>
          <PlayerProvider>
            <RootNavigator ready={fontsLoaded} />
            <PerfHud />
          </PlayerProvider>
        </AuthProvider>
      </ToastProvider>
    </SafeAreaProvider>
  );
}

// The auth gate: anonymous sessions can only see /auth, and a signed-in session never sits on
// a stale auth screen. Every 401 flips the session to anonymous, which lands here.
function RootNavigator({ ready }: { ready: boolean }) {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready || status === "loading") return;
    const onAuthScreen = segments[0] === "auth";

    if (status === "anonymous" && !onAuthScreen) router.replace("/auth");
    else if (status === "authenticated" && onAuthScreen) router.replace("/");
  }, [ready, status, segments, router]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.surface[0] }} />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.surface[0] },
        animation: "fade",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="auth" />
      <Stack.Screen name="book/[id]" />
      <Stack.Screen name="player" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
    </Stack>
  );
}
