import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Text } from "@/ui/Text";

/** Placeholder home screen of stage 0: proves the session works. The real home comes in stage 1. */
export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const { colors } = useTheme();
  const [confirming, setConfirming] = useState(false);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        <Text variant="title">Главная</Text>
        <Card>
          <Text variant="heading">{[user?.firstName, user?.lastName].filter(Boolean).join(" ")}</Text>
          <Text muted>{user?.email}</Text>
        </Card>
        <Button title="Выйти" variant="secondary" onPress={() => setConfirming(true)} />
      </View>
      <ConfirmModal
        visible={confirming}
        title="Выйти из аккаунта?"
        confirmLabel="Выйти"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void signOut();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 24, gap: 16, width: "100%", maxWidth: 560, alignSelf: "center" },
});
