import { useLocalSearchParams } from "expo-router";
import { getPost } from "@/api/blog";
import { PostArticle } from "@/blog/BlogContent";
import { useLoad } from "@/lib/useLoad";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";

export default function GuestArticleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, reload } = useLoad(() => getPost(id), [id]);
  const post = !error && data?.id === id && data.status === "published" ? data : null;

  return (
    <Screen header>
      {post ? <PostArticle post={post} guest /> : loading ? <LoadingView /> : (
        <ErrorView message={error ?? "Статья недоступна."} onRetry={reload} />
      )}
    </Screen>
  );
}
