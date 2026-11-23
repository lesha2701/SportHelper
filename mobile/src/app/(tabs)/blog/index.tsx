import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { listBlogSports, listMyPosts, listPosts, listSavedPosts, POST_STATUS_LABELS, type FeedSort } from "@/api/blog";
import { PostPages, PostPreview } from "@/blog/BlogContent";
import { useLoad } from "@/lib/useLoad";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { Screen } from "@/ui/Screen";
import { SelectField } from "@/ui/SelectField";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

type Tab = "all" | "mine" | "saved";
const TABS: { value: Tab; title: string }[] = [
  { value: "all", title: "Все" }, { value: "mine", title: "Мои" }, { value: "saved", title: "Сохранённые" },
];
const SORTS: { value: FeedSort; title: string }[] = [{ value: "new", title: "Новые" }, { value: "popular", title: "Популярные" }];

export default function BlogFeed() {
  const { tab: requestedTab } = useLocalSearchParams<{ tab?: string }>();
  const tab: Tab = requestedTab === "mine" || requestedTab === "saved" ? requestedTab : "all";
  const [sport, setSport] = useState("");
  const [sort, setSort] = useState<FeedSort>("new");
  const [offset, setOffset] = useState(0);
  const sports = useLoad(listBlogSports);
  const data = useLoad(async () => {
    if (tab === "mine") return { tab, posts: await listMyPosts() } as const;
    const page = tab === "all" ? await listPosts({ sport, sort, offset, limit: 20 }) : await listSavedPosts(offset);
    return { tab, sport, sort, offset, page } as const;
  }, [tab, sport, sort, offset]);
  const result = data.data?.tab === tab && (data.data.tab === "mine" || (
    data.data.sport === sport && data.data.sort === sort && data.data.offset === offset
  )) ? data.data : null;

  return (
    <>
      <Screen header onRefresh={data.reload} refreshing={data.loading && !!result}>
        <Button title="Написать статью" onPress={() => router.push("/blog/edit")} />
        <Choice layout="chips" options={TABS} value={tab} onChange={(next) => { router.setParams({ tab: next }); setOffset(0); }} />
        {tab === "all" ? (
          <>
            <SelectField label="Вид спорта" value={sport} options={[{ value: "", title: "Все виды спорта" }, ...(sports.data ?? []).map((value) => ({ value, title: value }))]} onChange={(value) => { setSport(value); setOffset(0); }} />
            <Choice layout="chips" options={SORTS} value={sort} onChange={(value) => { setSort(value); setOffset(0); }} />
          </>
        ) : null}
        {data.loading && !result ? <LoadingView /> : null}
        {data.error ? <ErrorView message={data.error} onRetry={data.reload} /> : null}
        {result?.tab === "mine" ? (
          <>
            {!result.posts.length ? <Text muted>Вы пока не написали ни одной статьи.</Text> : null}
            {result.posts.map((post) => (
              <Card key={post.id} onPress={() => router.push({ pathname: "/blog/[id]", params: { id: post.id } })}>
                <Text variant="heading">{post.title || "Без заголовка"}</Text>
                <Text muted>{POST_STATUS_LABELS[post.status] ?? "Статус обновляется"}</Text>
                {post.rejectReason ? <Text>{post.rejectReason}</Text> : null}
              </Card>
            ))}
          </>
        ) : result ? (
          <>
            {!result.page.items.length ? <Text muted>{tab === "saved" ? "Сохранённых статей пока нет." : "По этим условиям статей пока нет."}</Text> : null}
            {result.page.items.map((post) => <PostPreview key={post.id} post={post} />)}
            <PostPages offset={offset} total={result.page.total} onChange={setOffset} />
          </>
        ) : null}
      </Screen>
    </>
  );
}
