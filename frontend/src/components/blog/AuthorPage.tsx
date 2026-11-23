import { useEffect, useState } from "react";
import { getAuthor, listPosts, setAuthorMuted, type AuthorProfile, type PostCard } from "../../api/blog";
import { useAuth } from "../../context/AuthContext";
import { Link } from "../Link";
import { ProBadge } from "../shared/ProBadge";
import { StateScreen } from "../StateScreen";
import { Avatar } from "./Comments";
import { PostCardItem } from "./PostCardItem";
import styles from "./blog.module.css";

/** An author's card: a trainer's data and a way to his listings; a player's only if the player allowed it. Then their articles. */
export function AuthorPage({ authorId, feedUrl, onFeedChange }: { authorId: string; feedUrl: string; onFeedChange: () => void }) {
  const { state } = useAuth();
  const signedIn = state.status === "ready";
  const me = state.status === "ready" ? state.user.id : null;
  const [author, setAuthor] = useState<AuthorProfile | null>(null);
  const [posts, setPosts] = useState<PostCard[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAuthor(authorId)
      .then((loaded) => !cancelled && setAuthor(loaded))
      .catch(() => !cancelled && setFailed(true));
    listPosts({ authorId, limit: 50 })
      .then((page) => !cancelled && setPosts(page.items))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [authorId]);

  if (failed) return <StateScreen kind="error" title="Автор не найден" description="У него нет опубликованных статей." />;
  if (!author) return <StateScreen kind="loading" title="Загружаем…" />;

  const toggleMute = async () => {
    try {
      await setAuthorMuted(author.id, !author.mutedByMe);
      onFeedChange();
      setAuthor({ ...author, mutedByMe: !author.mutedByMe });
    } catch {
      /* the API layer already told the person why */
    }
  };

  return (
    <div className={styles.page}>
      <Link to={feedUrl} className={styles.moreLink}>
        ← К статьям
      </Link>
      <div className={styles.authorHero} style={{ marginTop: 12 }}>
        <Avatar author={author} />
        <div>
          <h1 className={styles.title} style={{ fontSize: 28 }}>
            {author.name}
            {author.isPro && <ProBadge />}
          </h1>
          <div className={styles.meta}>
            {author.sport && <span>{author.sport}</span>}
            {author.specialization && <span>{author.specialization}</span>}
            {author.experienceYears !== null && <span>Опыт: {author.experienceYears} лет</span>}
            <span>Статей: {author.postsCount}</span>
          </div>
        </div>
      </div>
      <div className={styles.row} style={{ marginBottom: 20 }}>
        {author.isCoach && (
          <Link to={`/coaches?coach=${author.id}`} className={styles.primary}>
            Профиль и объявления тренера
          </Link>
        )}
        {signedIn && me !== author.id && (
          <button type="button" className={styles.secondary} onClick={toggleMute}>
            {author.mutedByMe ? "Показывать статьи автора" : "Скрыть автора"}
          </button>
        )}
      </div>
      <div className={styles.list}>
        {posts.map((post) => (
          <PostCardItem key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}
