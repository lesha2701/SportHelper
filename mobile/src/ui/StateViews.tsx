import { ActivityIndicator, FlatList, StyleSheet, View, type FlatListProps } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "./Button";
import { Text } from "./Text";

export function LoadingView() {
  const { colors } = useTheme();
  return (
    <View style={styles.center} accessibilityLabel="Загрузка">
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

export function EmptyView({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.center}>
      <Text variant="heading">{title}</Text>
      {hint ? (
        <Text muted style={styles.centerText}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text variant="heading">Что-то пошло не так</Text>
      <Text muted style={styles.centerText}>
        {message}
      </Text>
      {onRetry ? <Button title="Повторить" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

/** A list with the usual states: loading, error with retry, empty, and pull-to-refresh. */
export function StateList<T>({
  loading,
  error,
  onRetry,
  emptyTitle,
  emptyHint,
  data,
  ...rest
}: Omit<FlatListProps<T>, "ListEmptyComponent"> & {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  emptyTitle: string;
  emptyHint?: string;
}) {
  if (loading && !data?.length) return <LoadingView />;
  if (error && !data?.length) return <ErrorView message={error} onRetry={onRetry} />;
  return <FlatList data={data} ListEmptyComponent={<EmptyView title={emptyTitle} hint={emptyHint} />} {...rest} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  centerText: { textAlign: "center" },
});
