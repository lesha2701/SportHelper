import { Stack } from "expo-router";
import { DeleteAccountCard } from "@/profile/DeleteAccountCard";
import { Screen } from "@/ui/Screen";

export default function DeleteAccountScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Удаление аккаунта" }} />
      <Screen header>
        <DeleteAccountCard />
      </Screen>
    </>
  );
}
