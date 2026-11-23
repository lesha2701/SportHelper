import type { PostCard } from "../../api/blog";
import { Link } from "../Link";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { ProBadge } from "../shared/ProBadge";
import { formatPostDate } from "./blogText";
import { Stat } from "./Stat";
import styles from "./blog.module.css";

/** An article in a list or in the home block: the cover, the sport, the title, the first lines and the numbers. */
export function PostCardItem({ post }: { post: PostCard }) {
  return (
    <Link to={`/blog/${post.id}`} className={`${styles.card} ${post.coverFileId ? "" : styles.cardNoCover}`}>
      {post.coverFileId && <AuthenticatedImage token="" fileId={post.coverFileId} alt="" className={styles.cover} thumb />}
      <div className={styles.cardBody}>
        <span className={styles.sport}>{post.sport}</span>
        <h3 className={styles.cardTitle}>{post.title}</h3>
        <p className={styles.excerpt}>{post.excerpt}</p>
        <div className={styles.meta}>
          <span>
            {post.author.name}
            {post.author.isPro && <ProBadge />}
          </span>
          <span>{formatPostDate(post.publishedAt)}</span>
          <Stat icon="heart" value={post.likesCount} label="Нравится" />
          <Stat icon="message" value={post.commentsCount} label="Комментарии" />
        </div>
      </div>
    </Link>
  );
}
