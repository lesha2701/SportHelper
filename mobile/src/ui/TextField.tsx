import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { Text } from "./Text";

interface Props extends Omit<TextInputProps, "style"> {
  label: string;
  error?: string | null;
  required?: boolean;
}

export function TextField({ label, error, required, secureTextEntry, multiline, ...input }: Props) {
  const { colors } = useTheme();
  // A password can be shown while typing: a 12-character password is easy to mistype blind on a phone.
  const [revealed, setRevealed] = useState(false);
  const isSecret = !!secureTextEntry;
  return (
    <View style={styles.wrap}>
      <Text variant="label" muted>
        {label}
        {required ? <Text variant="label" style={{ color: colors.primary }}> *</Text> : null}
      </Text>
      <View>
        <TextInput
          {...input}
          multiline={multiline}
          secureTextEntry={isSecret && !revealed}
          accessibilityLabel={label}
          placeholderTextColor={colors.textTertiary}
          textAlignVertical={multiline ? "top" : "center"}
          style={[
            styles.input,
            multiline && styles.multiline,
            isSecret && styles.withToggle,
            { color: colors.text, backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.borderStrong },
          ]}
        />
        {isSecret ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Скрыть пароль" : "Показать пароль"}
            hitSlop={8}
            onPress={() => setRevealed((v) => !v)}
            style={styles.toggle}
          >
            <Text variant="caption" style={{ color: colors.primary, fontFamily: fonts.bodySemi }}>
              {revealed ? "Скрыть" : "Показать"}
            </Text>
          </Pressable>
        ) : null}
      </View>
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
  multiline: { minHeight: 96, paddingTop: 12, paddingBottom: 12 },
  withToggle: { paddingRight: 86 },
  toggle: { position: "absolute", right: 14, top: 0, bottom: 0, justifyContent: "center" },
});
