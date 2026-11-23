import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import type { UploadFile } from "@/api/client";
import { View } from "react-native";
import { ApiError } from "@/api/client";
import { addListingDate, createListing, getListingAvailability, listListingDates, listMyListings, removeListingDate, replaceListingAvailability, updateListing, uploadListingPhoto, uploadListingVideo } from "@/api/coachListings";
import { pickMedia } from "@/lib/pickImage";
import { LoadingView } from "@/ui/StateViews";
import { toFormError } from "@/lib/formError";
import { addDays, formatRuDate, parseRuDate, parseTime, todayIso } from "@/shared/lib/dates";
import type { AvailabilityWindowInput, OneOffDateInput } from "@/shared/types/coachListing";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Choice } from "@/ui/Choice";
import { DateField, TimeField } from "@/ui/DateTimeFields";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const WEEKDAY_OPTIONS = WEEKDAYS.map((title, value) => ({ title, value: String(value) }));
type WeeklyWindow = AvailabilityWindowInput & { key: number | string };
type DateWindow = OneOffDateInput & { key: number | string; id?: string };

function overlap<T>(rows: T[], sameDay: (a: T, b: T) => boolean, times: (row: T) => [string, string]): [T, T] | undefined {
  for (const [i, row] of rows.entries()) {
    const [start, end] = times(row);
    const conflicting = rows.slice(i + 1).find((other) => {
      const [otherStart, otherEnd] = times(other);
      return sameDay(row, other) && start < otherEnd && otherStart < end;
    });
    if (conflicting) return [row, conflicting];
  }
  return undefined;
}

export default function NewListingScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [loading, setLoading] = useState(!!id);
  const [listed, setListed] = useState(true);
  const [photo, setPhoto] = useState<UploadFile | null>(null);
  const [video, setVideo] = useState<UploadFile | null>(null);
  const [has, setHas] = useState({ photo: false, video: false });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState("");
  const [online, setOnline] = useState(false);
  const [offline, setOffline] = useState(true);
  const nextKey = useRef(0);
  const savedListingId = useRef(id);
  const savedDates = useRef<string[]>([]);
  const savedWeekly = useRef("[]");
  const [windows, setWindows] = useState<WeeklyWindow[]>([]);
  const [dates, setDates] = useState<DateWindow[]>([]);
  const [errors, setErrors] = useState<{ title?: string; format?: string; schedule?: string; form?: string }>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [supportsDates, setSupportsDates] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      listMyListings(),
      getListingAvailability(id),
      listListingDates(id).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }),
    ])
      .then(([mine, windows, dates]) => {
        const l = mine.find((x) => x.id === id);
        if (!l) throw new Error("Предложение не найдено.");
        setTitle(l.title);
        setDescription(l.description ?? "");
        setPrice(l.pricePerSession !== null ? String(l.pricePerSession) : "");
        setDuration(l.sessionDurationMinutes ? String(l.sessionDurationMinutes) : "60");
        setLocation(l.location ?? "");
        setOnline(l.offersOnline);
        setOffline(l.offersOffline);
        setListed(l.isListed);
        setHas({ photo: !!l.photoFileId, video: !!l.videoFileId });
        const weekly = windows.map((w) => ({ weekday: w.weekday, start_time: w.startTime.slice(0, 5), end_time: w.endTime.slice(0, 5) }));
        savedWeekly.current = JSON.stringify(weekly);
        setWindows(weekly.map((window, index) => ({ ...window, key: windows[index]!.id })));
        setSupportsDates(dates !== null);
        setDates((dates ?? []).map((d) => ({ ...d, key: d.id, slot_date: formatRuDate(d.slot_date), start_time: d.start_time.slice(0, 5), end_time: d.end_time.slice(0, 5) })));
        savedDates.current = (dates ?? []).map((d) => d.id);
      })
      .catch((e: unknown) => setLoadError(toFormError(e).message))
      .finally(() => setLoading(false));
  }, [id]);

  async function submit() {
    if (busy || loadError) return;
    const found: typeof errors = {};
    const normalizedWindows = windows.map((w) => ({
      weekday: w.weekday, start_time: parseTime(w.start_time) ?? "", end_time: parseTime(w.end_time) ?? "",
    }));
    const normalizedDates = dates.map((d) => ({
      id: d.id, key: d.key, slot_date: parseRuDate(d.slot_date) ?? "",
      start_time: parseTime(d.start_time) ?? "", end_time: parseTime(d.end_time) ?? "",
    }));
    if (!title.trim()) found.title = "Укажите название предложения.";
    if (!online && !offline) found.format = "Выберите хотя бы один формат.";
    const today = todayIso();
    const lastDay = addDays(today, 365);
    const invalidTime = (w: { start_time: string; end_time: string }) => !w.start_time || !w.end_time || w.start_time >= w.end_time;
    const times = (w: { start_time: string; end_time: string }): [string, string] => [w.start_time, w.end_time];
    const weekClash = overlap(normalizedWindows, (a, b) => a.weekday === b.weekday, times);
    const dateClash = overlap(normalizedDates, (a, b) => a.slot_date === b.slot_date, times);
    if (listed && !windows.length && !dates.length) found.schedule = "Добавьте хотя бы одно окно в неделю или разовую дату.";
    else if ([...normalizedWindows, ...normalizedDates].some(invalidTime)) found.schedule = "Проверьте время: конец каждого окна должен быть позже начала.";
    else if (dates.length > 60) found.schedule = "Можно добавить до 60 разовых дат.";
    else if (normalizedDates.some((d) => !d.id && (d.slot_date < today || d.slot_date > lastDay))) found.schedule = "Введите разовую дату на ближайший год.";
    else if (weekClash) {
      const [a, b] = weekClash;
      found.schedule = `${WEEKDAYS[a.weekday]}: окна ${a.start_time}–${a.end_time} и ${b.start_time}–${b.end_time} пересекаются.`;
    } else if (dateClash) {
      const [a, b] = dateClash;
      found.schedule = `${formatRuDate(a.slot_date)}: окна ${a.start_time}–${a.end_time} и ${b.start_time}–${b.end_time} пересекаются.`;
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const input = {
        title: title.trim(),
        description: description.trim() || null,
        is_listed: false,
        price_per_session: price.trim() ? Number(price.replace(",", ".")) || 0 : null,
        currency: "RUB",
        offers_online: online,
        offers_offline: offline,
        location: location.trim() || null,
        session_duration_minutes: parseInt(duration, 10) || null,
      };
      const listingId = savedListingId.current ?? (await createListing(input)).id;
      savedListingId.current = listingId;
      const removed = savedDates.current.filter((dateId) => !normalizedDates.some((date) => date.id === dateId));
      for (const dateId of removed) {
        try {
          await removeListingDate(listingId, dateId);
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
        }
        savedDates.current = savedDates.current.filter((savedId) => savedId !== dateId);
      }
      for (const date of normalizedDates) {
        if (date.id) continue;
        const created = await addListingDate(listingId, { slot_date: date.slot_date, start_time: date.start_time, end_time: date.end_time });
        savedDates.current.push(created.id);
        setDates((current) => current.map((item) => item.key === date.key ? { ...item, id: created.id } : item));
      }
      const weekly = JSON.stringify(normalizedWindows);
      if (weekly !== savedWeekly.current) {
        await replaceListingAvailability(listingId, normalizedWindows);
        savedWeekly.current = weekly;
      }
      if (photo) {
        await uploadListingPhoto(listingId, photo);
        setPhoto(null);
        setHas((current) => ({ ...current, photo: true }));
      }
      if (video) {
        await uploadListingVideo(listingId, video);
        setVideo(null);
        setHas((current) => ({ ...current, video: true }));
      }
      await updateListing(listingId, { ...input, is_listed: listed });
      if (id) router.back();
      else router.replace("/my-listings");
    } catch (e) {
      setErrors({ form: toFormError(e).message });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingView />;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: id ? "Редактировать предложение" : "Новое предложение" }} />
      <Screen header>
        {loadError ? <Notice kind="danger">{loadError}</Notice> : null}
        {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
        <TextField label="Название" required value={title} onChangeText={setTitle} maxLength={200} error={errors.title} />
        <TextField label="Описание" value={description} onChangeText={setDescription} multiline numberOfLines={4} maxLength={2000} />
        <TextField label="Цена за занятие, ₽" value={price} onChangeText={setPrice} keyboardType="decimal-pad" maxLength={8} />
        <TextField label="Длительность занятия, мин" value={duration} onChangeText={setDuration} keyboardType="number-pad" maxLength={3} />
        <TextField label="Место" value={location} onChangeText={setLocation} maxLength={200} />
        <View style={{ gap: 8 }}>
          <SwitchRow label="Онлайн" value={online} onChange={setOnline} />
          <SwitchRow label="Очно" value={offline} onChange={setOffline} />
          {errors.format ? <Text variant="caption" style={{ color: "#e85d2a" }}>{errors.format}</Text> : null}
        </View>
        <Text variant="heading">Недельное расписание</Text>
        {windows.map((window) => (
          <Card key={window.key}>
            <Choice label="День недели" layout="chips" options={WEEKDAY_OPTIONS} value={String(window.weekday)} onChange={(weekday) => setWindows((rows) => rows.map((row) => row.key === window.key ? { ...row, weekday: Number(weekday) } : row))} />
            <TimeField label="С" value={window.start_time} onChange={(start_time) => setWindows((rows) => rows.map((row) => row.key === window.key ? { ...row, start_time } : row))} />
            <TimeField label="До" value={window.end_time} onChange={(end_time) => setWindows((rows) => rows.map((row) => row.key === window.key ? { ...row, end_time } : row))} />
            <Button title="Убрать окно" variant="ghost" onPress={() => setWindows((rows) => rows.filter((row) => row.key !== window.key))} />
          </Card>
        ))}
        <Button title="Добавить окно" variant="secondary" onPress={() => {
          const key = nextKey.current++;
          setWindows((rows) => [...rows, { key, weekday: 0, start_time: "10:00", end_time: "18:00" }]);
        }} />
        {supportsDates ? (
          <>
            <Text variant="heading">Разовые даты</Text>
            {dates.map((date) => (
              <Card key={date.key}>
                {date.id ? (
                  <Text>{date.slot_date}, {date.start_time}–{date.end_time}</Text>
                ) : (
                  <>
                    <DateField label="Дата" value={date.slot_date} onChange={(slot_date) => setDates((rows) => rows.map((row) => row.key === date.key ? { ...row, slot_date } : row))} shortcuts />
                    <TimeField label="С" value={date.start_time} onChange={(start_time) => setDates((rows) => rows.map((row) => row.key === date.key ? { ...row, start_time } : row))} />
                    <TimeField label="До" value={date.end_time} onChange={(end_time) => setDates((rows) => rows.map((row) => row.key === date.key ? { ...row, end_time } : row))} />
                  </>
                )}
                <Button title="Убрать дату" variant="ghost" onPress={() => setDates((rows) => rows.filter((row) => row.key !== date.key))} />
              </Card>
            ))}
            <Button title="Добавить дату" variant="secondary" onPress={() => {
              const key = nextKey.current++;
              setDates((rows) => [...rows, { key, slot_date: formatRuDate(todayIso()), start_time: "10:00", end_time: "18:00" }]);
            }} />
          </>
        ) : null}
        {errors.schedule ? <Notice kind="danger">{errors.schedule}</Notice> : null}
        <Text variant="heading">Фото и видео</Text>
        {photo ? <Text muted>Фото выбрано: {photo.name}</Text> : null}
        <Button
          title={photo || has.photo ? "Заменить фото" : "Добавить фото"}
          variant="secondary"
          onPress={async () => {
            const f = await pickMedia("image");
            if (f) setPhoto(f);
          }}
        />
        {video ? <Text muted>Видео выбрано: {video.name}</Text> : null}
        <Button
          title={video || has.video ? "Заменить видео" : "Добавить видео"}
          variant="secondary"
          onPress={async () => {
            const f = await pickMedia("video");
            if (f) setVideo(f);
          }}
        />
        {id ? <SwitchRow label="Показывать в каталоге тренеров" value={listed} onChange={setListed} /> : null}
        <Button title={id ? "Сохранить" : "Опубликовать"} onPress={submit} loading={busy} disabled={!!loadError} />
      </Screen>
    </>
  );
}
