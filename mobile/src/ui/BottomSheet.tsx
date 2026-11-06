import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { Text } from "./Text";

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Pinned under the scrolling content (the "apply" buttons). */
  footer?: React.ReactNode;
}

/** A panel that slides up from the bottom over a dimmed screen: filters, pickers. A tap outside closes it. */
export function BottomSheet({ visible, title, onClose, children, footer }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose} accessibilityLabel="Закрыть" />
      <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
        <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />
        <Text variant="heading" style={styles.title}>
          {title}
        </Text>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { maxHeight: "85%", borderTopLeftRadius: radius.lg * 1.5, borderTopRightRadius: radius.lg * 1.5, borderWidth: 1, paddingTop: 10 },
  grabber: { width: 44, height: 5, borderRadius: 3, alignSelf: "center", marginBottom: 8 },
  title: { paddingHorizontal: 20, marginBottom: 8 },
  content: { paddingHorizontal: 20, paddingBottom: 8, gap: 16 },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
});
