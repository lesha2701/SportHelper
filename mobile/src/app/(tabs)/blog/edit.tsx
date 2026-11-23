import { Stack, router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { BODY_MAX, BODY_MIN, createPost, getPost, listBlogSports, MAX_POST_IMAGES, TITLE_MAX, TITLE_MIN, updatePost, uploadPostImage, type BlockType, type Post, type PostBlock } from "@/api/blog";
import { listMyListings } from "@/api/coachListings";
import { PostBody, PostPhotos } from "@/blog/BlogContent";
import { toFormError } from "@/lib/formError";
import { pickMedia } from "@/lib/pickImage";
import { useLoad } from "@/lib/useLoad";
import { useProfile } from "@/profile/ProfileProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { PhotoBox } from "@/ui/PhotoBox";
import { Screen } from "@/ui/Screen";
import { SelectField } from "@/ui/SelectField";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";

type EditableBlock = { key: number; type: BlockType; text: string };
const BLOCK_TYPES: { value: BlockType; title: string }[] = [
  { value: "paragraph", title: "Абзац" }, { value: "heading", title: "Заголовок" },
  { value: "quote", title: "Цитата" }, { value: "list", title: "Список" },
];

function BlockEditor({ block, onChange, onRemove, onMove, first, last, disabled }: {
  block: EditableBlock;
  onChange: (block: EditableBlock) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  first: boolean;
  last: boolean;
  disabled: boolean;
}) {
  const selection = useRef<{ start: number; end: number } | null>(null);
  function wrap(marker: string) {
    const { start, end } = selection.current ?? { start: block.text.length, end: block.text.length };
    const selected = block.text.slice(start, end);
    const inserted = selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2
      ? selected.slice(marker.length, -marker.length)
      : marker + selected + marker;
    onChange({ ...block, text: block.text.slice(0, start) + inserted + block.text.slice(end) });
  }
  return (
    <Card>
      <Choice label="Тип блока" layout="chips" value={block.type} options={BLOCK_TYPES} disabled={disabled} onChange={(type) => onChange({ ...block, type })} />
      <TextField label={block.type === "list" ? "Один пункт на строку" : "Текст блока"} value={block.text} multiline editable={!disabled} maxLength={10000}
        onChangeText={(text) => onChange({ ...block, text })} onSelectionChange={(event) => { selection.current = event.nativeEvent.selection; }} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button title="Жирный" variant="ghost" disabled={disabled} onPress={() => wrap("**")} />
        <Button title="Курсив" variant="ghost" disabled={disabled} onPress={() => wrap("*")} />
        <Button title="Выше" variant="ghost" disabled={disabled || first} onPress={() => onMove(-1)} />
        <Button title="Ниже" variant="ghost" disabled={disabled || last} onPress={() => onMove(1)} />
        <Button title="Убрать блок" variant="ghost" disabled={disabled} onPress={onRemove} />
      </View>
    </Card>
  );
}

function Editor({ post, initialSport, coach, sports }: { post: Post | null; initialSport: string; coach: boolean; sports: string[] }) {
  const listings = useLoad(async () => coach ? (await listMyListings()).filter((listing) => listing.isListed) : [], [coach]);
  const toast = useToast();
  const [title, setTitle] = useState(post?.title ?? "");
  const [sport, setSport] = useState(post?.sport ?? initialSport);
  const [blocks, setBlocks] = useState<EditableBlock[]>(() => post?.blocks.length ? post.blocks.map((block, key) => ({
    key, type: block.type, text: block.type === "list" ? (block.items ?? []).join("\n") : block.text ?? "",
  })) : [{ key: 0, type: "paragraph", text: "" }]);
  const key = useRef(blocks.length);
  const [photos, setPhotos] = useState<string[]>(post?.imageIds ?? []);
  const [listingId, setListingId] = useState(post?.listing?.id ?? "");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body: PostBlock[] = blocks.flatMap<PostBlock>((block) => {
    if (!block.text.trim()) return [];
    if (block.type === "list") return [{ type: "list", items: block.text.split("\n").map((line) => line.trim()).filter(Boolean) }];
    return [{ type: block.type, text: block.text.trim() }];
  });

  async function addPhoto() {
    if (busy || photos.length >= MAX_POST_IMAGES) return;
    setBusy(true);
    setError(null);
    try {
      const file = await pickMedia("image");
      if (file) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          setError("Выберите фотографию JPEG, PNG или WebP.");
          return;
        }
        const id = await uploadPostImage(file);
        setPhotos((previous) => [...previous, id]);
      }
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function save(submit: boolean) {
    if (busy) return;
    const length = body.flatMap((block) => block.type === "list" ? block.items ?? [] : [block.text ?? ""])
      .reduce((sum, text) => sum + Array.from(text.replace(/\*{1,2}/g, "")).length, 0);
    if (!sport) return setError("Выберите вид спорта.");
    if (submit && title.trim().length < TITLE_MIN) return setError("Введите заголовок от 3 символов.");
    if (length > BODY_MAX || (submit && length < BODY_MIN)) return setError(`Текст статьи должен содержать от ${BODY_MIN} до ${BODY_MAX} символов.`);
    setBusy(true);
    setError(null);
    const input = { title: title.trim(), sport, blocks: body, imageIds: photos, listingId: listingId || null, submit };
    try {
      const saved = post ? await updatePost(post.id, input) : await createPost(input);
      toast.success(saved.status === "pending" ? "Статья отправлена на проверку" : saved.status === "published" ? "Статья опубликована" : "Черновик сохранён");
      router.replace({ pathname: "/blog/[id]", params: { id: saved.id } });
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <Button title={preview ? "Вернуться в редактор" : "Предпросмотр"} variant="secondary" disabled={busy} onPress={() => setPreview(!preview)} />
      {preview ? (
        <>
          <Text variant="title">{title || "Без заголовка"}</Text>
          <PostPhotos ids={photos} />
          <PostBody blocks={body} />
        </>
      ) : (
        <>
          <TextField label="Заголовок" value={title} onChangeText={setTitle} maxLength={TITLE_MAX} editable={!busy} />
          <SelectField label="Вид спорта" value={sport} options={sports.map((item) => ({ value: item, title: item }))} onChange={setSport} />
          {blocks.map((block, index) => (
            <BlockEditor key={block.key} block={block} disabled={busy} first={index === 0} last={index === blocks.length - 1}
              onChange={(next) => setBlocks((rows) => rows.map((row) => row.key === next.key ? next : row))}
              onRemove={() => setBlocks((rows) => rows.filter((row) => row.key !== block.key))}
              onMove={(direction) => setBlocks((rows) => {
                const next = [...rows];
                const target = index + direction;
                [next[index], next[target]] = [next[target]!, next[index]!];
                return next;
              })} />
          ))}
          <Button title="Добавить блок" variant="secondary" disabled={busy || blocks.length >= 60} onPress={() => {
            const id = key.current++;
            setBlocks((rows) => [...rows, { key: id, type: "paragraph", text: "" }]);
          }} />
          <Text variant="heading">Фото</Text>
          {photos.map((id) => (
            <Card key={id}>
              <PhotoBox fileId={id} height={145} />
              <Button title="Убрать фото" variant="ghost" disabled={busy} onPress={() => setPhotos((previous) => previous.filter((photo) => photo !== id))} />
            </Card>
          ))}
          <Button title="Добавить фото" variant="secondary" disabled={busy || photos.length >= MAX_POST_IMAGES} onPress={() => void addPhoto()} />
          {coach ? <SelectField label="Объявление для записи" value={listingId} options={[
            { value: "", title: "Без объявления" }, ...(listings.data ?? []).map((listing) => ({ value: listing.id, title: listing.title })),
          ]} onChange={setListingId} /> : null}
          {listings.error ? <ErrorView message={listings.error} onRetry={listings.reload} /> : null}
        </>
      )}
      {post?.status !== "published" && post?.status !== "pending" ? <Button title="Сохранить черновик" variant="secondary" disabled={busy} onPress={() => void save(false)} /> : null}
      <Button title={post?.status === "published" ? "Сохранить изменения" : "Отправить на проверку"} loading={busy} onPress={() => void save(true)} />
    </>
  );
}

export default function BlogEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state } = useProfile();
  const data = useLoad(async () => {
    const [sports, post] = await Promise.all([listBlogSports(), id ? getPost(id) : null]);
    return { sports, post };
  }, [id]);
  const profile = state.status === "ready" ? state.data : null;
  const coach = profile?.activeMode === "coach" || (!!profile?.coach && !profile.player);
  const sport = coach ? profile?.coach?.sport : profile?.player?.sport;
  const item = data.data;
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: id ? "Редактировать статью" : "Написать статью" }} />
      <Screen header>
        {data.loading && !item ? <LoadingView /> : null}
        {data.error ? <ErrorView message={data.error} onRetry={data.reload} /> : null}
        {item && (item.post?.id ?? undefined) === id ? (
          item.post && !item.post.isMine ? <Notice kind="danger">Редактировать статью может её автор.</Notice>
            : <Editor key={id ?? "new"} post={item.post} sports={item.sports} initialSport={sport && item.sports.includes(sport) ? sport : ""} coach={coach} />
        ) : null}
      </Screen>
    </>
  );
}
