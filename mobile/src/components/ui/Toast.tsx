import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, elevation, radius } from "@/theme/tokens";
import { AppText } from "./Text";

type ToastTone = "info" | "error" | "success";

interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
}

interface ToastApi {
  showToast: (text: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi>({ showToast: () => undefined });

const TOAST_DURATION_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const showToast = useCallback((text: string, tone: ToastTone = "info") => {
    const id = nextIdRef.current++;
    setMessages((current) => [...current.slice(-2), { id, text, tone }]);
    const timer = setTimeout(() => setMessages((current) => current.filter((message) => message.id !== id)), TOAST_DURATION_MS);
    timersRef.current.push(timer);
  }, []);

  useEffect(
    () => () => {
      for (const timer of timersRef.current) clearTimeout(timer);
    },
    [],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);
  const insets = useSafeAreaInsets();

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View pointerEvents="none" style={[styles.host, { top: insets.top + 8 }]}>
        {messages.map((message) => (
          <View
            key={message.id}
            style={[styles.toast, message.tone === "error" ? styles.error : message.tone === "success" ? styles.success : styles.info]}
          >
            <AppText variant="caption" tone="primary">
              {message.text}
            </AppText>
          </View>
        ))}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 16, right: 16, gap: 8, alignItems: "center" },
  toast: {
    maxWidth: 460,
    width: "100%",
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: colors.surface[3],
    ...elevation.e2,
  },
  info: { borderColor: colors.line.strong },
  error: { borderColor: "rgba(244, 151, 139, 0.45)" },
  success: { borderColor: "rgba(143, 211, 174, 0.4)" },
});
