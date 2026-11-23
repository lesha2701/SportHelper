import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Image, Linking, Pressable, StyleSheet, View } from "react-native";
import { featuredPost } from "@/api/blog";
import { SITE_URL } from "@/config";
import { useLoad } from "@/lib/useLoad";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { AuthImage } from "@/ui/AuthImage";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

const STEPS = [
  { title: "Найдите тренера", description: "Посмотрите профили, отзывы, цены и свободное время в каталоге." },
  { title: "Запишитесь на занятие", description: "Выберите время. Когда тренер подтвердит запись, она появится в календаре." },
  { title: "Тренируйтесь и растите", description: "Следите за прогрессом по итогам занятий, заданиям и статистике." },
];

const ROLES = [
  { title: "Игрокам", points: ["Личный календарь тренировок и матчей", "Записи к тренерам и отзывы после занятий", "Задания, метрики и разбор прогресса"] },
  { title: "Тренерам", points: ["Объявления и расписание с доступными слотами", "Матчи и отчёты", "Планы тренировок и библиотека упражнений"] },
];

export function GuestHome() {
  const { colors, dark, setPreference } = useTheme();
  const toast = useToast();
  const featured = useLoad(featuredPost);
  const post = featured.data;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.brand}>
          <Image source={require("../../assets/sportarena-logo.webp")} style={styles.logo} accessible={false} />
          <Text variant="heading" style={styles.brandName}>SportArena</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dark ? "Включить светлую тему" : "Включить тёмную тему"}
          onPress={() => setPreference(dark ? "light" : "dark")}
          style={({ pressed }) => [styles.themeButton, { backgroundColor: pressed ? colors.surfaceAlt : colors.surface }]}
        >
          <Ionicons name={dark ? "sunny-outline" : "moon-outline"} color={colors.text} size={20} />
        </Pressable>
        <Button title="Войти" variant="secondary" onPress={() => router.push("/login")} />
      </View>

      <View style={styles.hero}>
        <Text variant="label" muted>Платформа для игроков и тренеров</Text>
        <Text variant="title" accessibilityRole="header">
          Тренируйся <Text variant="title" style={{ color: colors.primary }}>с планом.</Text>
          {"\n"}Расти <Text variant="title" style={{ color: colors.primary }}>с командой.</Text>
        </Text>
        <Text muted>Находите тренеров, записывайтесь на занятия, ведите календарь, задания и статистику.</Text>
        <View style={styles.actions}>
          <Button title="Найти тренера" onPress={() => {
            void Linking.openURL(`${SITE_URL}/coaches`).catch(() => toast.error("Не удалось открыть каталог тренеров."));
          }} />
          <Button title="Создать аккаунт" variant="secondary" onPress={() => router.push("/register")} />
        </View>
      </View>

      <View style={styles.featured}>
        <Button title="Все статьи →" variant="ghost" style={styles.allArticles} onPress={() => router.push("/guest/articles")} />
        {post && (
          <Card style={{ borderStartWidth: 2, borderStartColor: colors.primary }}>
            {post.coverFileId ? <AuthImage fileId={post.coverFileId} height={115} thumb /> : (
              __DEV__ && post.sport === "Футбол" && (
                <Image source={require("../../assets/article-football-preview.webp")} style={styles.cover} resizeMode="cover" accessible={false} />
              )
            )}
            <Text variant="label" muted>Статья дня</Text>
            <Text accessibilityRole="header" style={styles.articleTitle}>{post.title}</Text>
            <Button title="Читать далее →" variant="ghost" style={styles.readArticle} onPress={() => router.push({
              pathname: "/guest/articles/[id]", params: { id: post.id },
            })} />
          </Card>
        )}
      </View>

      <View style={styles.section}>
        <Text variant="title" accessibilityRole="header">Как это работает</Text>
        {STEPS.map((step, index) => (
          <Card key={step.title}>
            <Text variant="heading" accessibilityRole="header">{index + 1}. {step.title}</Text>
            <Text muted>{step.description}</Text>
          </Card>
        ))}
      </View>

      <View style={styles.section}>
        <Text variant="title" accessibilityRole="header">Для кого</Text>
        {ROLES.map((role) => (
          <Card key={role.title}>
            <Text variant="heading" accessibilityRole="header">{role.title}</Text>
            {role.points.map((point) => <Text key={point} muted>• {point}</Text>)}
          </Card>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  brand: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  logo: { width: 32, height: 32 },
  brandName: { flexShrink: 1, fontSize: 18 },
  themeButton: { width: 48, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  hero: { gap: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  featured: { marginTop: 4 },
  allArticles: { alignSelf: "flex-end" },
  cover: { width: "100%", height: 115, borderRadius: radius.md },
  articleTitle: { fontFamily: fonts.bodyBold, fontSize: 18, lineHeight: 24 },
  readArticle: { alignSelf: "flex-start", paddingHorizontal: 0 },
  section: { gap: 8, marginTop: 12 },
});
