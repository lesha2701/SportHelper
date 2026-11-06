import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { GUIDE_STEPS, type GuideStep, type GuideTile } from "./guideSteps";

export type GuideResult = "completed" | "skipped";

function Tile({ tile, wide, compact }: { tile: GuideTile; wide?: boolean; compact?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tile, wide ? styles.tileWide : null, compact ? styles.tileCompact : null, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.tileIcon, { backgroundColor: colors.primaryGlow }]}>
        <Ionicons name={tile.icon} size={20} color={colors.primary} />
      </View>
      <Text variant="label" style={{ textAlign: "center", fontSize: compact ? 10 : 12 }} numberOfLines={2}>
        {tile.label}
      </Text>
    </View>
  );
}

function Visual({ step, roles }: { step: GuideStep; roles?: { player: boolean; coach: boolean } }) {
  const { colors } = useTheme();
  const v = step.visual;
  if (v.kind === "roles") {
    const role = (icon: GuideTile["icon"], label: string, mine?: boolean) => (
      <View style={[styles.roleCard, { backgroundColor: colors.surface, borderColor: mine ? colors.primary : colors.border }]}>
        <View style={[styles.tileIcon, { backgroundColor: colors.primaryGlow }]}>
          <Ionicons name={icon} size={22} color={colors.primary} />
        </View>
        <Text variant="label">{label}</Text>
        {mine ? (
          <Text variant="caption" style={{ color: colors.primary }}>
            Ваша роль
          </Text>
        ) : null}
      </View>
    );
    return (
      <View style={styles.roles}>
        {role("football-outline", "Игрок", roles?.player)}
        <Ionicons name="swap-horizontal" size={22} color={colors.textTertiary} />
        {role("clipboard-outline", "Тренер", roles?.coach)}
      </View>
    );
  }
  return (
    <View style={{ gap: 10, alignItems: "center" }}>
      {v.badge ? (
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Ionicons name="sparkles" size={14} color="#fff" />
          <Text variant="label" style={{ color: "#fff", fontSize: 12 }}>
            {v.badge}
          </Text>
        </View>
      ) : null}
      {v.kind === "flow" ? (
        <View style={styles.flow}>
          {v.items.map((t, i) => (
            <View key={t.label} style={styles.flowStep}>
              <Tile tile={t} compact />
              {i < v.items.length - 1 ? <Ionicons name="chevron-forward" size={10} color={colors.textTertiary} /> : null}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.grid}>
          {v.items.map((t, i) => (
            <Tile key={t.label} tile={t} wide={v.items.length % 2 === 1 && v.items.length > 3 && i === v.items.length - 1} />
          ))}
        </View>
      )}
    </View>
  );
}

/** The website's welcome guide: a short tour of what the app does. On first entry it can be skipped; opened from
 * the settings («manual») it only has a close button. */
export function WelcomeGuide({ manual = false, roles, onFinish }: { manual?: boolean; roles?: { player: boolean; coach: boolean }; onFinish: (result: GuideResult) => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const step = GUIDE_STEPS[index]!;
  const last = index === GUIDE_STEPS.length - 1;
  const primary = index === 0 ? "Начать знакомство" : last ? (manual ? "Готово" : "Перейти в SportArenaGlobal") : "Далее";

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.top}>
        <View style={styles.dots} accessibilityLabel={`Шаг ${index + 1} из ${GUIDE_STEPS.length}`}>
          {GUIDE_STEPS.map((s, i) => (
            <View
              key={s.id}
              style={[styles.dot, { backgroundColor: i <= index ? colors.primary : colors.border, opacity: i < index ? 0.5 : 1 }, i === index ? styles.dotActive : null]}
            />
          ))}
        </View>
        {manual ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" hitSlop={10} onPress={() => onFinish("completed")}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" hitSlop={10} onPress={() => onFinish("skipped")}>
            <Text variant="label" muted>
              Пропустить
            </Text>
          </Pressable>
        )}
      </View>

      <ScrollView key={step.id} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={[styles.visual, { backgroundColor: colors.surfaceAlt }]}>
          <Visual step={step} roles={roles} />
        </View>
        {step.kicker ? (
          <Text variant="label" style={{ color: colors.primary, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {step.kicker}
          </Text>
        ) : null}
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          {step.title}
        </Text>
        <Text style={{ fontSize: 16, lineHeight: 23 }}>{step.lead}</Text>
        {step.points?.map((p) => (
          <View key={p} style={styles.point}>
            <View style={[styles.bullet, { backgroundColor: colors.primary }]} />
            <Text muted style={{ flex: 1 }}>
              {p}
            </Text>
          </View>
        ))}
        {step.extra ? <Text muted>{step.extra}</Text> : null}
      </ScrollView>

      <View style={styles.actions}>
        {index > 0 ? <Button title="Назад" variant="secondary" onPress={() => setIndex(index - 1)} style={{ flex: 1 }} /> : null}
        <Button title={primary} onPress={() => (last ? onFinish("completed") : setIndex(index + 1))} style={{ flex: index > 0 ? 2 : 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, gap: 12 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 28 },
  dots: { flexDirection: "row", gap: 5, flex: 1, flexWrap: "wrap" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { width: 22 },
  body: { gap: 12, paddingBottom: 8 },
  visual: { borderRadius: radius.lg * 1.5, paddingVertical: 22, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", minHeight: 170 },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 33, textTransform: "uppercase" },
  point: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  actions: { flexDirection: "row", gap: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 330 },
  tile: { width: 102, borderWidth: 1, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 6, alignItems: "center", gap: 6 },
  tileWide: { width: 212 },
  tileCompact: { width: 73, paddingHorizontal: 1 },
  tileIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  flow: { flexDirection: "row", alignItems: "center" },
  flowStep: { flexDirection: "row", alignItems: "center" },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 12 },
  roles: { flexDirection: "row", alignItems: "center", gap: 14 },
  roleCard: { width: 110, borderWidth: 1.5, borderRadius: radius.lg, paddingVertical: 16, alignItems: "center", gap: 6 },
});
