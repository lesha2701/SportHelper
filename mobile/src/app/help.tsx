import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

interface Section {
  icon: IconName;
  title: string;
  intro: string;
  items?: { label: string; text: string }[];
}

/** The website's «Помощь», worded for the app. */
const SECTIONS: Section[] = [
  {
    icon: "home-outline",
    title: "Главная",
    intro:
      "Сводка на сегодня. У игрока — ближайшее событие, посещаемость, серия посещений, задания, неделя, последние матчи и рекомендации ИИ. У тренера — то же по вашим командам, нагрузка команды, кто требует внимания, и быстрые действия: тренировка, задание, матч.",
  },
  {
    icon: "people-outline",
    title: "Команды",
    intro: "Создайте команду (тренер) или вступите по ссылке-приглашению (игрок). Внутри команды несколько разделов:",
    items: [
      { label: "Состав", text: "участники, роли и позиции; тренер приглашает по ссылке, принимает заявки, назначает помощников и капитана, смотрит профиль и статистику игрока, может удалить или заблокировать участника." },
      { label: "Тренировки", text: "расписание (можно серией по неделям), посещаемость, отчёты и отзыв после занятия." },
      { label: "Задания", text: "поручения с дедлайном: игрок берёт задание в работу и отправляет отчёт (текст, фото, видео, подходы, показатели), тренер проверяет и комментирует." },
      { label: "Матчи", text: "игры, состав на матч и результат." },
      { label: "Статистика", text: "посещаемость, задания и матчи команды; тренер видит ещё, кто пропускает, и разборы ИИ." },
      { label: "Приглашения", text: "ссылки для игроков и заявки на вступление; главный тренер может передать свою роль." },
    ],
  },
  {
    icon: "library-outline",
    title: "Библиотека (для тренера)",
    intro: "Рабочие материалы — один раз описываете и используете в любых командах.",
    items: [
      { label: "Упражнения", text: "описание, техника, ошибки, инвентарь, сложность, фото и видео (до 1 минуты). Упражнением можно поделиться с командой." },
      { label: "Планы", text: "упражнения по разминке, основной части и заминке; план можно скопировать, привязать к тренировке и открыть команде." },
      { label: "Шаблоны заданий", text: "заготовки с упражнениями, показателем и требованиями к отчёту." },
    ],
  },
  {
    icon: "calendar-outline",
    title: "Календарь",
    intro: "Тренировки, матчи, дедлайны заданий и занятия с тренерами по всем командам. «Неделя» — дни недели и все события списком, «День» — один день. Здесь же можно добавить личную тренировку.",
  },
  {
    icon: "barbell-outline",
    title: "Тренеры",
    intro: "Каталог тренеров для индивидуальных занятий.",
    items: [
      { label: "Поиск и фильтры", text: "вид спорта, город, цена, рейтинг и формат (онлайн или очно)." },
      { label: "Профиль тренера", text: "опыт, о себе, достижения, предложения и отзывы." },
      { label: "Запись", text: "выберите предложение, день и время, оставьте пожелание. После подтверждения занятие появится в календаре у вас обоих." },
      { label: "После занятия", text: "тренер отмечает «Тренировка проведена», и вы оцениваете друг друга." },
    ],
  },
  {
    icon: "person-outline",
    title: "Профиль",
    intro: "Ваша карточка и личные разделы: фото и достижения, данные игрока или тренера, предложения и заявки (тренер), записи, статистика, уведомления, аккаунт и настройки.",
  },
  {
    icon: "notifications-outline",
    title: "Уведомления",
    intro: "Колокольчик вверху экрана показывает ленту: напоминания, новые тренировки, матчи и задания, заявки и их результат. Нажатие открывает нужный экран. Что получать — в «Профиль → Настройки».",
  },
  {
    icon: "sparkles-outline",
    title: "Подсказки ИИ",
    intro: "Рекомендации и сводки ИИ: по нагрузке игрока, состоянию команды, черновики планов и заданий, оценка тренировки. Это подсказки — решение всегда за вами.",
  },
  {
    icon: "lock-closed-outline",
    title: "Вход и данные",
    intro: "Вход по почте и паролю. Данные в приложении и на сайте общие. Пароль, почту и устройства можно изменить в «Аккаунт и безопасность».",
  },
];

function HelpCard({ s }: { s: Section }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.head}>
        <View style={[styles.icon, { backgroundColor: colors.primaryGlow }]}>
          <Ionicons name={s.icon} size={20} color={colors.primary} />
        </View>
        <Text variant="label" style={{ flex: 1, fontSize: 16 }}>
          {s.title}
        </Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.textTertiary} />
      </Pressable>
      {open ? (
        <View style={{ gap: 8 }}>
          <Text muted>{s.intro}</Text>
          {s.items?.map((i) => (
            <Text key={i.label}>
              <Text variant="label">{i.label}</Text> — {i.text}
            </Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** «Помощь»: how each part of the app works, and the welcome guide again. */
export default function HelpScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Помощь" }} />
      <Screen header>
        <Button title="Как работает SportArenaGlobal" variant="secondary" onPress={() => router.push("/guide")} />
        {SECTIONS.map((s) => (
          <HelpCard key={s.title} s={s} />
        ))}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});
