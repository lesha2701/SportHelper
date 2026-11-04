import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { Text } from "./Text";

interface Props extends Omit<TextInputProps, "style"> {
  label: string;
  error?: string | null;
  required?: boolean;
}

export function TextField({ label, error, required, ...input }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text variant="label" muted>
        {label}
        {required ? <Text variant="label" style={{ color: colors.primary }}> *</Text> : null}
      </Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        placeholderTextColor={colors.textTertiary}
        style={[
          styles.input,
          { color: colors.text, backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.borderStrong },
        ]}
      />
      {error ? (
        <Text variant="caption" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, fontFamily: fonts.body, fontSize: 16 },
});
