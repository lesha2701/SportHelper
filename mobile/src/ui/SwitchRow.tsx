import { Switch, View } from "react-native";
import { Text } from "./Text";

export function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Text style={{ flex: 1 }}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} />
    </View>
  );
}
