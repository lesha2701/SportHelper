import { useEffect, useState } from "react";
import { featuredPost, type PostCard } from "../../api/blog";
import { Link } from "../Link";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import footballPreview from "../../assets/article-football-preview.webp";
import publicStyles from "../public/public.module.css";
import { PostCardItem } from "./PostCardItem";
import styles from "./blog.module.css";

/** The home-page pick. Inside the workspace, the feed link preserves the selected sport. */
export function FeaturedPost({ placement = "workspace" }: { placement?: "workspace" | "public" }) {
  const [post, setPost] = useState<PostCard | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    featuredPost()
      .then((card) => {
        if (cancelled) return;
        setPost(card);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled && placement === "public") setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [placement]);

  if (!loaded) return null;
  if (placement === "public") {
    if (!post) return null;
    return (
      <aside className={publicStyles.teaserAside} aria-label="Статьи">
        <div className={publicStyles.articleTeaser}>
          {post.coverFileId ? (
            <AuthenticatedImage token="" fileId={post.coverFileId} alt="" className={publicStyles.teaserCover} thumb />
          ) : import.meta.env.DEV && post.sport === "Футбол" ? (
            <img src={footballPreview} alt="" className={publicStyles.teaserCover} />
          ) : null}
          <div className={publicStyles.teaserBody}>
            <span className={publicStyles.teaserLabel}>Статья дня</span>
            <h2 className={publicStyles.teaserTitle}>{post.title}</h2>
            <Link to={`/blog/${post.id}`} className={publicStyles.teaserRead}>
              Читать далее <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </aside>
    );
  }
  if (!post) {
    // No articles yet: the block is the way in for the first author.
    return (
      <section className={styles.featured} aria-label="Статьи">
        <div className={styles.featuredHead}>
          <span className={styles.featuredLabel}>Статьи</span>
          <Link to="/blog" className={styles.moreLink}>
            Открыть →
          </Link>
        </div>
        <p className={styles.excerpt}>Здесь появятся статьи тренеров и игроков. Напишите первую — расскажите о тренировках и опыте.</p>
      </section>
    );
  }
  return (
    <section className={styles.featured} aria-label="Статья по вашему виду спорта">
      <div className={styles.featuredHead}>
        <span className={styles.featuredLabel}>Статья дня</span>
        <Link to={`/blog?sport=${encodeURIComponent(post.sport)}&sort=popular`} className={styles.moreLink}>
          Все статьи →
        </Link>
      </div>
      <PostCardItem post={post} />
    </section>
  );
}
