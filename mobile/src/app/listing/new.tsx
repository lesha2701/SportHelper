import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import type { UploadFile } from "@/api/client";
import { View } from "react-native";
import { createListing, getListingAvailability, listMyListings, replaceListingAvailability, updateListing, uploadListingPhoto, uploadListingVideo } from "@/api/coachListings";
import { pickMedia } from "@/lib/pickImage";
import { LoadingView } from "@/ui/StateViews";
import { toFormError } from "@/lib/formError";
import { parseTime } from "@/shared/lib/dates";
import { Button } from "@/ui/Button";
import { Choice } from "@/ui/Choice";
import { TimeField } from "@/ui/DateTimeFields";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** An offer, new or edited (?id=): what the coach sells, for how much, a photo and a video, and when they are free
 * (the same hours on the chosen weekdays). */
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
  const [days, setDays] = useState<string[]>([]);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("18:00");
  const [errors, setErrors] = useState<{ title?: string; format?: string; days?: string; from?: string; to?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([listMyListings(), getListingAvailability(id)])
      .then(([mine, windows]) => {
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
        setDays([...new Set(windows.map((w) => String(w.weekday)))]);
        if (windows[0]) {
          setFrom(windows[0].startTime.slice(0, 5));
          setTo(windows[0].endTime.slice(0, 5));
        }
      })
      .catch((e: unknown) => setErrors({ form: e instanceof Error ? e.message : toFormError(e).message }))
      .finally(() => setLoading(false));
  }, [id]);

  async function submit() {
    const found: typeof errors = {};
    const start = parseTime(from);
    const end = parseTime(to);
    if (!title.trim()) found.title = "Укажите название предложения.";
    if (!online && !offline) found.format = "Выберите хотя бы один формат.";
    if (days.length === 0) found.days = "Выберите хотя бы один день приёма.";
    if (days.length > 0 && !start) found.from = "Введите время как ЧЧ:ММ.";
    if (days.length > 0 && !end) found.to = "Введите время как ЧЧ:ММ.";
    if (start && end && days.length > 0 && end <= start) found.to = "Конец должен быть позже начала.";
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
      // The server publishes an offer only once it has a schedule: create hidden, set the hours, then publish.
      const listing = id ? { id } : await createListing(input);
      await replaceListingAvailability(
        listing.id,
        days.map((d) => ({ weekday: Number(d), start_time: start!, end_time: end! })),
      );
      await updateListing(listing.id, { ...input, is_listed: id ? listed : true });
      if (photo) await uploadListingPhoto(listing.id, photo);
      if (video) await uploadListingVideo(listing.id, video);
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
        <Text variant="heading">Когда вы свободны</Text>
        <Text muted>Выберите дни недели и часы приёма. Клиенты смогут записаться на свободное время.</Text>
        <Choice
          layout="chips"
          options={WEEKDAYS.map((label, i) => ({ value: String(i), title: label }))}
          value={null}
          selected={days}
          onChange={(d) => {
            setDays((current) => (current.includes(d) ? current.filter((x) => x !== d) : [...current, d]));
            setErrors((current) => ({ ...current, days: undefined }));
          }}
        />
        {errors.days ? <Text variant="caption" style={{ color: "#e85d2a" }}>{errors.days}</Text> : null}
        <Text variant="caption" muted>
          Выбрано: {days.length ? [...days].sort().map((d) => WEEKDAYS[Number(d)]).join(", ") : "ничего"}
        </Text>
        <TimeField label="С" value={from} onChange={setFrom} error={errors.from} />
        <TimeField label="До" value={to} onChange={setTo} error={errors.to} />
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
        <Button title={id ? "Сохранить" : "Опубликовать"} onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
