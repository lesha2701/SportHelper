import { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { getToken } from "@/api/tokenStore";
import { API_BASE_URL } from "@/config";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts } from "@/theme/tokens";
import { Text } from "./Text";

interface Props {
  /** The stored picture; without it (or if it fails to load) the initials are shown. */
  fileId?: string | null;
  name: string;
  size?: number;
  square?: boolean;
}

/** A round picture of a person (or a rounded square for a team) with initials as a fallback. */
export function Avatar({ fileId, name, size = 64, square }: Props) {
  const { colors } = useTheme();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void getToken().then(setToken);
  }, []);
  useEffect(() => setFailed(false), [fileId]);

  const radius = square ? size * 0.2 : size / 2;
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";

  if (fileId && token !== undefined && !failed) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri: `${API_BASE_URL}/api/files/${fileId}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.surfaceAlt }}
      />
    );
  }
  return (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: radius, backgroundColor: colors.primaryGlow, borderColor: colors.border }]}>
      <Text style={{ color: colors.primary, fontFamily: fonts.display, fontSize: size * 0.4, lineHeight: size * 0.5 }}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ fallback: { alignItems: "center", justifyContent: "center", borderWidth: 1 } });
