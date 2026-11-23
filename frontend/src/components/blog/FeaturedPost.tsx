import { useEffect, useState } from "react";
import { featuredPost, type PostCard } from "../../api/blog";
import { Link } from "../Link";
import { PostCardItem } from "./PostCardItem";
import styles from "./blog.module.css";

/** The one article on the home page: the best of the person's sport. «Все статьи» opens the feed on that sport. Nothing is shown
 *  when there are no articles yet, or if the request fails. */
export function FeaturedPost() {
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
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;
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
