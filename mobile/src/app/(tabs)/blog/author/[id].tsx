import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { getAuthor, listPosts, setAuthorMuted } from "@/api/blog";
import { useAuth } from "@/auth/AuthProvider";
import { PostPages, PostPreview } from "@/blog/BlogContent";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Notice } from "@/ui/Notice";
import { ProBadge } from "@/ui/ProBadge";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

export default function BlogAuthorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previous = useLoad(() => getAuthor(id), [id]);
  const posts = useLoad(async () => ({ id, offset, page: await listPosts({ authorId: id, limit: 20, offset }) }), [id, offset]);
  const author = !previous.error && previous.data?.id === id ? previous.data : null;
  const page = author && posts.data?.id === id && posts.data.offset === offset ? posts.data.page : null;

  async function mute() {
    if (!author) return;
    setSaving(true);
    setError(null);
    try {
      await setAuthorMuted(author.id, !author.mutedByMe);
      previous.reload();
      posts.reload();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Автор" }} />
      <Screen header>
        {previous.loading && !author ? <LoadingView /> : null}
        {previous.error ? <ErrorView message={previous.error} onRetry={previous.reload} /> : null}
        {author ? (
          <Card>
            <Avatar fileId={author.avatarFileId} name={author.name} size={52} />
            <Text variant="heading">{author.name}{author.isPro ? <> <ProBadge /></> : null}</Text>
            <Text muted>{[author.sport, author.specialization, author.experienceYears != null ? `${author.experienceYears} лет опыта` : null].filter(Boolean).join(" · ")}</Text>
            {author.profileOpen ? <Button title={author.isCoach ? "Профиль и объявления" : "Профиль игрока"} variant="secondary" onPress={() => router.push({ pathname: author.isCoach ? "/coach/[id]" : "/player/[id]", params: { id: author.id } })} /> : null}
            {user?.id !== author.id ? <Button title={author.mutedByMe ? "Снова показывать автора" : "Скрыть автора"} variant="ghost" loading={saving} onPress={() => void mute()} /> : null}
            {error ? <Notice kind="danger">{error}</Notice> : null}
          </Card>
        ) : null}
        {posts.loading && !page ? <LoadingView /> : null}
        {posts.error ? <ErrorView message={posts.error} onRetry={posts.reload} /> : null}
        {page?.items.map((post) => <PostPreview key={post.id} post={post} />)}
        {page ? <PostPages offset={offset} total={page.total} onChange={setOffset} /> : null}
      </Screen>
    </>
  );
}
