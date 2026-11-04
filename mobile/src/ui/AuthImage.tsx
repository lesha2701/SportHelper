import { useEffect, useState } from "react";
import { Image, StyleSheet } from "react-native";
import { getToken } from "@/api/tokenStore";
import { API_BASE_URL } from "@/config";
import { radius } from "@/theme/tokens";

/** A picture stored on the server (/api/files/{id}); the request carries the session token. */
export function AuthImage({ fileId, height = 200 }: { fileId: string; height?: number }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void getToken().then(setToken);
  }, []);
  if (token === undefined) return null;
  return (
    <Image
      accessibilityIgnoresInvertColors
      source={{ uri: `${API_BASE_URL}/api/files/${fileId}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
      style={[styles.image, { height }]}
      resizeMode="cover"
    />
  );
}

const styles = StyleSheet.create({ image: { width: "100%", borderRadius: radius.md } });
