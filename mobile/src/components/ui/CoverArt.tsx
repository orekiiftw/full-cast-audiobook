import { useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { getBearerToken } from "@/api/client";
import { apiUrl } from "@/api/client";
import { coverStreamUrl } from "@/api/audio";
import { colors, elevation, radius } from "@/theme/tokens";
import { AppText } from "./Text";

interface CoverArtProps {
  coverR2Key?: string | null;
  title: string;
  width: number;
  style?: ViewStyle;
}

// Cover art streams from the same authenticated `/api/audio` route as segment audio, so the
// image request carries the bearer token too. A missing or forbidden cover falls back to the
// typographic plate the web client uses, which is the common case for acquired books.
//
// The image goes through `expo-image` rather than React Native's `Image`: a cached cover is
// decoded once and reused across the library grid, the detail hero and a scroll that recycles
// both, instead of being fetched again on every mount. `memory-disk` keeps it for the session
// and on disk, which is what makes a second look at the library instant.
export function CoverArt({ coverR2Key, title, width, style }: CoverArtProps) {
  const [failed, setFailed] = useState(false);
  const streamPath = coverStreamUrl(coverR2Key);
  const token = getBearerToken();
  const uri = streamPath ? apiUrl(streamPath) : null;

  return (
    <View style={[styles.frame, { width, height: width * 1.5 }, elevation.cover, style]}>
      {uri && !failed ? (
        <Image
          accessibilityLabel={`Cover of ${title}`}
          source={token ? { uri, headers: { Authorization: `Bearer ${token}` } } : { uri }}
          style={styles.image}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={180}
          // A recycled grid row must not show the previous card's cover while the next decodes.
          recyclingKey={uri}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={styles.plate}>
          <View style={styles.plateRule} />
          <AppText variant="titleMd" tone="primary" style={styles.plateTitle} numberOfLines={4}>
            {title}
          </AppText>
          <View style={styles.plateRule} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radius.control,
    overflow: "hidden",
    backgroundColor: colors.surface[2],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line.strong,
  },
  image: { width: "100%", height: "100%" },
  plate: {
    flex: 1,
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 10,
    backgroundColor: colors.surface[3],
  },
  plateRule: { width: 22, height: 1, backgroundColor: colors.line.accent },
  plateTitle: { textAlign: "center", fontSize: 15, lineHeight: 20 },
});
