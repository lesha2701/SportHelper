import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { getToken } from "@/api/tokenStore";
import { API_BASE_URL } from "@/config";
import { radius } from "@/theme/tokens";

function Player({ uri, token, height }: { uri: string; token: string | null; height: number }) {
  const player = useVideoPlayer({ uri, headers: token ? { Authorization: `Bearer ${token}` } : undefined }, (p) => {
    p.loop = false;
  });
  return <VideoView player={player} style={[styles.video, { height }]} nativeControls contentFit="contain" />;
}

/** A video stored on the server (/api/files/{id}); the request carries the session token. */
export function AuthVideo({ fileId, height = 220 }: { fileId: string; height?: number }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void getToken().then(setToken);
  }, []);
  if (token === undefined) return null;
  return <Player uri={`${API_BASE_URL}/api/files/${fileId}`} token={token} height={height} />;
}

const styles = StyleSheet.create({ video: { width: "100%", borderRadius: radius.md, backgroundColor: "#000" } });
