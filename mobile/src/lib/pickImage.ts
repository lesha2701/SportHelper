import * as ImagePicker from "expo-image-picker";
import type { UploadFile } from "@/api/client";

/** Lets the person choose a photo from the gallery, cropped square; null when they back out. */
export async function pickSquareImage(): Promise<UploadFile | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, name: asset.fileName ?? "photo.jpg", type: asset.mimeType ?? "image/jpeg" };
}

/** A photo or a video from the gallery (as asked), with which of the two it turned out to be; null when they back out. */
export async function pickMedia(kind: "image" | "video" | "any" = "any"): Promise<(UploadFile & { video: boolean }) | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: kind === "image" ? ["images"] : kind === "video" ? ["videos"] : ["images", "videos"],
    quality: 0.8,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const video = asset.type === "video";
  return { uri: asset.uri, name: asset.fileName ?? (video ? "video.mp4" : "photo.jpg"), type: asset.mimeType ?? (video ? "video/mp4" : "image/jpeg"), video };
}
