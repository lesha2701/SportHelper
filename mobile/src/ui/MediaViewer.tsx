import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthImage } from "./AuthImage";
import { AuthVideo } from "./AuthVideo";
import { Text } from "./Text";

export interface ViewerItem {
  kind: "image" | "video";
  fileId: string;
}

/** A photo or video on the whole screen, with arrows between the items of a gallery (the website's lightbox). */
export function MediaViewer({ items, index, onIndex, onClose }: { items: ViewerItem[]; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const item = index !== null ? items[index] : undefined;
  return (
    <Modal visible={!!item} animationType="fade" transparent={false} onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.top}>
          <Text style={{ color: "#fff" }}>{items.length > 1 && index !== null ? `${index + 1} из ${items.length}` : ""}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" hitSlop={12} onPress={onClose}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.body}>{item ? item.kind === "image" ? <AuthImage key={item.fileId} fileId={item.fileId} height="100%" fit="contain" /> : <AuthVideo key={item.fileId} fileId={item.fileId} height={320} /> : null}</View>
        {items.length > 1 && index !== null ? (
          <View style={styles.nav}>
            <Pressable accessibilityRole="button" accessibilityLabel="Предыдущее" disabled={index === 0} onPress={() => onIndex(index - 1)} style={{ opacity: index === 0 ? 0.3 : 1 }}>
              <Ionicons name="chevron-back-circle" size={44} color="#fff" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Следующее"
              disabled={index === items.length - 1}
              onPress={() => onIndex(index + 1)}
              style={{ opacity: index === items.length - 1 ? 0.3 : 1 }}
            >
              <Ionicons name="chevron-forward-circle" size={44} color="#fff" />
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", paddingHorizontal: 12, gap: 12 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  body: { flex: 1, justifyContent: "center" },
  nav: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 24 },
});
