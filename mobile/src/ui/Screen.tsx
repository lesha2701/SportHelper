import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeProvider";

interface Props {
  children: React.ReactNode;
  /** Vertically centres the content (sign-in style screens). */
  centered?: boolean;
  /** Plain View instead of a ScrollView, for screens that hold their own list. */
  fixed?: boolean;
  /** The screen sits under a navigation header, which already clears the status bar: no second top inset. */
  header?: boolean;
  /** Pull-down to refresh: called when the person pulls; `refreshing` shows the spinner. */
  onRefresh?: () => void;
  refreshing?: boolean;
}

/** The standard screen frame: safe area, theme background, keyboard avoidance, a readable column on wide screens. */
export function Screen({ children, centered, fixed, header, onRefresh, refreshing }: Props) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={header ? ["bottom", "left", "right"] : ["top", "bottom", "left", "right"]} style={[styles.fill, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.fill}>
        {fixed ? (
          <View style={[styles.column, styles.fill]}>{children}</View>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.content, centered && styles.centered]}
            keyboardShouldPersistTaps="handled"
            refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}
          >
            <View style={styles.column}>{children}</View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, padding: 20 },
  centered: { justifyContent: "center" },
  column: { width: "100%", maxWidth: 520, alignSelf: "center", gap: 16 },
});
