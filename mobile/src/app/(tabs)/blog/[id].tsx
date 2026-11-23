import * as Clipboard from "expo-clipboard";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { addComment, countView, deleteComment, deletePost, getPost, listComments, POST_STATUS_LABELS, setBookmark, setLike, setPostHidden, submitDraft, type Post } from "@/api/blog";
import { PostAuthorLink, PostBody, PostPhotos, PostStats } from "@/blog/BlogContent";
import { SITE_URL } from "@/config";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Notice } from "@/ui/Notice";
import { PhotoBox } from "@/ui/PhotoBox";
import { ReportButton } from "@/ui/ReportButton";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";

export default function BlogPostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useLoad(() => getPost(id), [id]);
  const [submitted, setSubmitted] = useState<Post | null>(null);
  const loaded = !data.error && data.data?.id === id ? data.data : null;
  const post = loaded?.status === "draft" && submitted?.id === id ? submitted : loaded;
  const isOwnDraft = post?.isMine && post.status === "draft";
  const published = post?.status === "published";
  const comments = useLoad(async () => published ? await listComments(id) : [], [id, published]);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<{ target: "post" | "comment"; id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (published) void countView(id).catch(() => undefined);
  }, [id, published]);

  async function act(action: () => Promise<unknown>, refresh = true) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await action();
      if (refresh) {
        data.reload();
        comments.reload();
      }
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Статья" }} />
      <Screen header>
        {data.loading && !post ? <LoadingView /> : null}
        {data.error ? <ErrorView message={data.error} onRetry={data.reload} /> : null}
        {post ? (
          <>
            {isOwnDraft ? (
              <Card>
                <Text variant="heading">Черновик</Text>
                <Text muted>Статью видите только вы.</Text>
                <Button title="Отправить на проверку" loading={saving} disabled={data.loading} onPress={() => void act(async () => {
                  const result = await submitDraft(post.id);
                  setSubmitted(result);
                  if (result.status === "published") toast.success("Статья опубликована");
                  else toast.success("Статья отправлена на проверку");
                }, false)} />
                <Button title="Редактировать" variant="secondary" disabled={saving} onPress={() => router.push({ pathname: "/blog/edit", params: { id: post.id } })} />
                {error ? <Notice kind="danger">{error}</Notice> : null}
              </Card>
            ) : post.isMine ? (
              <Notice>{POST_STATUS_LABELS[post.status] ?? "Статус обновляется"}{post.rejectReason ? `. ${post.rejectReason}` : ""}</Notice>
            ) : null}
            <Text variant="title">{post.title || "Без заголовка"}</Text>
            <Text muted>{post.sport}{post.publishedAt ? ` · ${new Date(post.publishedAt).toLocaleDateString("ru-RU")}` : ""}</Text>
            <PostAuthorLink author={post.author} />
            <PostPhotos ids={post.imageIds} />
            <PostBody blocks={post.blocks} />
            {!isOwnDraft && error ? <Notice kind="danger">{error}</Notice> : null}
            {post.listing ? (
              <Card>
                {post.listing.photoFileId ? <PhotoBox fileId={post.listing.photoFileId} height={140} /> : null}
                <Text variant="heading">{post.listing.title}</Text>
                {post.listing.pricePerSession !== null ? <Text>{post.listing.pricePerSession} {post.listing.currency === "RUB" ? "₽" : post.listing.currency}</Text> : null}
                {published ? <Button title="Записаться" onPress={() => router.push({ pathname: "/listing/[id]", params: { id: post.listing!.id, booking: "1" } })} /> : null}
              </Card>
            ) : null}
            {published ? <PostStats post={post} /> : null}
            {post.isMine ? (
              <>
                {!isOwnDraft ? <Button title="Редактировать" variant="secondary" onPress={() => router.push({ pathname: "/blog/edit", params: { id: post.id } })} /> : null}
                <Button title="Удалить статью" variant="ghost" disabled={saving} onPress={() => setDeleting({ target: "post", id: post.id })} />
              </>
            ) : null}
            {published ? (
              <>
                <Button title={post.likedByMe ? "Убрать отметку «Нравится»" : "Нравится"} variant="secondary" disabled={saving || data.loading} onPress={() => void act(() => setLike(id, !post.likedByMe))} />
                <Button title={post.bookmarkedByMe ? "Убрать из сохранённых" : "Сохранить статью"} variant="secondary" disabled={saving || data.loading} onPress={() => void act(() => setBookmark(id, !post.bookmarkedByMe))} />
                <Button title="Скопировать ссылку" variant="ghost" disabled={saving} onPress={() => void act(async () => {
                  const copied = await Clipboard.setStringAsync(`${SITE_URL}/blog/${encodeURIComponent(id)}`);
                  if (!copied) throw new Error("Не удалось скопировать ссылку.");
                  toast.success("Ссылка скопирована");
                }, false)} />
                {!post.isMine ? (
                  <>
                    <Button title="Скрыть статью" variant="ghost" disabled={saving} onPress={() => void act(async () => {
                      await setPostHidden(id, true);
                      router.replace("/blog");
                    }, false)} />
                    <ReportButton targetType="post" targetId={id} ownerUserId={post.author.id} />
                  </>
                ) : null}
                <Text variant="heading">Комментарии</Text>
                {comments.loading && !comments.data ? <LoadingView /> : null}
                {comments.error ? <ErrorView message={comments.error} onRetry={comments.reload} /> : null}
                {comments.data?.map((comment) => (
                  <Card key={comment.id}>
                    <PostAuthorLink author={comment.author} />
                    <Text>{comment.body}</Text>
                    <Text variant="caption" muted>{new Date(comment.createdAt).toLocaleString("ru-RU")}</Text>
                    {comment.isMine
                      ? <Button title="Удалить комментарий" variant="ghost" disabled={saving} onPress={() => setDeleting({ target: "comment", id: comment.id })} />
                      : <ReportButton targetType="post_comment" targetId={comment.id} ownerUserId={comment.author.id} />}
                  </Card>
                ))}
                <TextField label="Ваш комментарий" value={draft} onChangeText={setDraft} maxLength={1000} multiline />
                <Button title="Отправить комментарий" disabled={!draft.trim() || saving} onPress={() => void act(async () => {
                  await addComment(id, draft.trim());
                  setDraft("");
                })} />
              </>
            ) : null}
          </>
        ) : null}
        <ConfirmModal visible={deleting !== null} title={deleting?.target === "post" ? "Удалить статью?" : "Удалить комментарий?"} confirmLabel="Удалить" destructive onCancel={() => setDeleting(null)} onConfirm={() => {
          if (!deleting) return;
          const item = deleting;
          setDeleting(null);
          void act(async () => {
            if (item.target === "comment") await deleteComment(item.id);
            else {
              await deletePost(item.id);
              router.replace("/blog");
            }
          }, item.target === "comment");
        }} />
      </Screen>
    </>
  );
}
