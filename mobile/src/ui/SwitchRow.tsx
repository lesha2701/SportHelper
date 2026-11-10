import { View } from "react-native";
import { Toggle } from "./Toggle";
import { Text } from "./Text";

export function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Text style={{ flex: 1 }}>{label}</Text>
      <Toggle accessibilityLabel={label} value={value} onValueChange={onChange} />
    </View>
  );
}
