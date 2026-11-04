import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { Button } from "./Button";
import { Text } from "./Text";

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ visible, title, message, confirmLabel = "Подтвердить", cancelLabel = "Отмена", destructive, onConfirm, onCancel }: Props) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onCancel}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => {}}>
          <Text variant="heading">{title}</Text>
          {message ? <Text muted>{message}</Text> : null}
          <View style={styles.actions}>
            <Button title={cancelLabel} variant="secondary" onPress={onCancel} style={styles.action} />
            <Button title={confirmLabel} variant={destructive ? "danger" : "primary"} onPress={onConfirm} style={styles.action} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 24 },
  sheet: { borderWidth: 1, borderRadius: radius.lg, padding: 20, gap: 12, maxWidth: 480, width: "100%", alignSelf: "center" },
  actions: { flexDirection: "row", gap: 12, marginTop: 8 },
  action: { flex: 1 },
});
