import { router } from "expo-router";
import { Fragment } from "react";
import { ScrollView, View } from "react-native";
import type { PostBlock, PostCard } from "@/api/blog";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { PhotoBox } from "@/ui/PhotoBox";
import { ProBadge } from "@/ui/ProBadge";
import { Text } from "@/ui/Text";

function Inline({ value }: { value: string }) {
  return value.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).map((part, i) => i % 2 === 0
    ? <Fragment key={i}>{part}</Fragment>
    : part.startsWith("**")
      ? <Text key={i} style={{ fontWeight: "700" }}>{part.slice(2, -2)}</Text>
      : <Text key={i} style={{ fontStyle: "italic" }}>{part.slice(1, -1)}</Text>);
}

export function PostBody({ blocks }: { blocks: PostBlock[] }) {
  const { colors } = useTheme();
  return blocks.map((block, i) => {
    if (block.type === "list") {
      return <View key={i}>{(block.items ?? []).map((item, j) => <Text key={j}>• <Inline value={item} /></Text>)}</View>;
    }
    return (
      <Text key={i} variant={block.type === "heading" ? "heading" : "body"} muted={block.type === "quote"}
        style={block.type === "quote" ? { borderLeftWidth: 2, borderLeftColor: colors.primary, paddingLeft: 12 } : undefined}>
        <Inline value={block.text ?? ""} />
      </Text>
    );
  });
}

export function PostPhotos({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  if (ids.length === 1) return <PhotoBox fileId={ids[0]!} height={220} />;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: 10 }}>
      {ids.map((id) => <View key={id} style={{ width: 260 }}><PhotoBox fileId={id} height={210} /></View>)}
    </ScrollView>
  );
}

export function PostStats({ post }: { post: PostCard }) {
  return <Text variant="caption" muted>Понравилось: {post.likesCount} · Комментарии: {post.commentsCount} · Просмотры: {post.viewsCount}</Text>;
}

export function PostPreview({ post }: { post: PostCard }) {
  return (
    <Card onPress={() => router.push({ pathname: "/blog/[id]", params: { id: post.id } })}>
      {post.coverFileId ? <PhotoBox fileId={post.coverFileId} height={170} /> : null}
      <Text variant="heading">{post.title}</Text>
      <Text variant="caption" muted>{post.sport} · {post.author.name}{post.author.isPro ? <> <ProBadge /></> : null}</Text>
      <Text numberOfLines={3}>{post.excerpt}</Text>
      <PostStats post={post} />
    </Card>
  );
}

export function PostAuthorLink({ author }: { author: PostCard["author"] }) {
  return (
    <Card onPress={() => router.push({ pathname: "/blog/author/[id]", params: { id: author.id } })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Avatar fileId={author.avatarFileId} name={author.name} size={36} />
        <Text variant="label">{author.name}{author.isPro ? <> <ProBadge /></> : null}</Text>
      </View>
    </Card>
  );
}

export function PostPages({ offset, total, onChange }: { offset: number; total: number; onChange: (value: number) => void }) {
  if (total <= 20 && offset === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Button title="Предыдущая страница" variant="secondary" disabled={offset === 0} onPress={() => onChange(Math.max(offset - 20, 0))} />
      <Button title="Следующая страница" variant="secondary" disabled={offset + 20 >= total} onPress={() => onChange(offset + 20)} />
    </View>
  );
}
