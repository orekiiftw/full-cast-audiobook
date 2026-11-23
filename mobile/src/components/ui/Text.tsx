import { Text, type TextProps, type TextStyle } from "react-native";
import { colors, fonts, type } from "@/theme/tokens";

export type TextVariant = keyof typeof type;

export type TextTone = "primary" | "secondary" | "tertiary" | "disabled" | "gold" | "goldStrong" | "inverse" | "danger" | "success";

const toneColor: Record<TextTone, string> = {
  primary: colors.ink.primary,
  secondary: colors.ink.secondary,
  tertiary: colors.ink.tertiary,
  disabled: colors.ink.disabled,
  gold: colors.gold[300],
  goldStrong: colors.gold[400],
  inverse: colors.ink.inverse,
  danger: colors.danger[300],
  success: colors.success[300],
};

interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  italic?: boolean;
  mono?: boolean;
  uppercase?: boolean;
  bold?: boolean;
  center?: boolean;
}

// The type ramp from the web client: display/title sizes are Fraunces, body sizes are DM
// Sans, and the "eyebrow" label is the micro size in caps with wide tracking. Custom font
// families carry their own weight on Android, so weight is a family choice, not a style.
export function AppText({
  variant = "body",
  tone = "primary",
  italic = false,
  mono = false,
  uppercase = false,
  bold = false,
  center = false,
  style,
  ...rest
}: AppTextProps) {
  const token = type[variant];
  const isSerif = variant.startsWith("display") || variant.startsWith("title");

  let fontFamily: string;
  if (mono) fontFamily = fonts.mono;
  else if (italic) fontFamily = isSerif ? fonts.serifItalic : fonts.sansItalic;
  else if (bold) fontFamily = isSerif ? fonts.serifBold : fonts.sansBold;
  else if (isSerif) fontFamily = fonts.serif;
  else fontFamily = fonts.sans;

  const computed: TextStyle = {
    fontSize: token.fontSize,
    lineHeight: token.lineHeight,
    letterSpacing: token.letterSpacing,
    color: toneColor[tone],
    fontFamily,
    textAlign: center ? "center" : undefined,
    ...(uppercase ? { textTransform: "uppercase" as const, fontSize: 11, lineHeight: 14, letterSpacing: 1.5 } : null),
  };

  return <Text {...rest} style={[computed, style]} />;
}

export function Eyebrow({ children, tone = "goldStrong", ...rest }: Omit<AppTextProps, "variant" | "uppercase">) {
  return (
    <AppText variant="micro" tone={tone} uppercase {...rest}>
      {children}
    </AppText>
  );
}
