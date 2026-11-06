import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { getToken } from "@/api/tokenStore";
import { API_BASE_URL } from "@/config";
import { radius } from "@/theme/tokens";
import { Text } from "./Text";

type VideoModule = typeof import("expo-video");

/** Loaded on demand and guarded: a runtime without the native part must not crash the app at start. */
function videoModule(): VideoModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-video") as VideoModule;
  } catch {
    return null;
  }
}

function Player({ video, uri, token, height }: { video: VideoModule; uri: string; token: string | null; height: number }) {
  const player = video.useVideoPlayer({ uri, headers: token ? { Authorization: `Bearer ${token}` } : undefined }, (p) => {
    p.loop = false;
  });
  return <video.VideoView player={player} style={[styles.video, { height }]} nativeControls contentFit="contain" />;
}

/** A video stored on the server (/api/files/{id}); the request carries the session token. */
export function AuthVideo({ fileId, height = 220 }: { fileId: string; height?: number }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void getToken().then(setToken);
  }, []);
  if (token === undefined) return null;
  const video = videoModule();
  if (!video) {
    return (
      <Text variant="caption" muted>
        Просмотр видео здесь недоступен.
      </Text>
    );
  }
  return <Player video={video} uri={`${API_BASE_URL}/api/files/${fileId}`} token={token} height={height} />;
}

const styles = StyleSheet.create({ video: { width: "100%", borderRadius: radius.md, backgroundColor: "#000" } });
