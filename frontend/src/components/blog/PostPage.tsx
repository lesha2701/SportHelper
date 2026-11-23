import { useCallback, useEffect, useState } from "react";
import { countView, deletePost, getPost, POST_STATUS_LABELS, setLike, type Post } from "../../api/blog";
import { ApiError } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { currentPathWithSearch, loginUrl, navigate } from "../../router";
import { Link } from "../Link";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { ConfirmModal } from "../shared/ConfirmModal";
import { ProBadge } from "../shared/ProBadge";
import { StateScreen } from "../StateScreen";
import { Carousel } from "./Carousel";
import { Avatar, Comments } from "./Comments";
import { PostBody, formatPostDate } from "./blogText";
import { PostMenu } from "./PostMenu";
import styles from "./blog.module.css";

/** One article, readable without signing in. A signed-in reader can like, save, comment, hide and report; the author edits and deletes. */
export function PostPage({ postId }: { postId: string }) {
  const { state } = useAuth();
  const signedIn = state.status === "ready";
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPost(null);
    setError(null);
    getPost(postId)
      .then((loaded) => {
        if (cancelled) return;
        setPost(loaded);
        if (signedIn && loaded.status === "published" && !loaded.isMine) void countView(postId).catch(() => undefined);
      })
      .catch((err) => !cancelled && setError({ notFound: err instanceof ApiError && err.status === 404, message: err instanceof ApiError ? err.message : "Не удалось загрузить статью" }));
    return () => {
      cancelled = true;
    };
  }, [postId, signedIn]);

  const patch = useCallback((change: Partial<Post>) => setPost((current) => (current ? { ...current, ...change } : current)), []);
  const setCount = useCallback((commentsCount: number) => patch({ commentsCount }), [patch]);

  if (error) {
    return (
      <div className={styles.page}>
        <StateScreen
          kind="error"
          title={error.notFound ? "Статья не найдена" : "Не удалось открыть статью"}
          description={error.notFound ? "Её могли удалить или скрыть." : error.message}
          onRetry={error.notFound ? undefined : () => navigate(currentPathWithSearch(), { replace: true })}
        />
        <p>
          <Link to="/blog" className={styles.moreLink}>
            ← Все статьи
          </Link>
        </p>
      </div>
    );
  }
  if (!post) return <StateScreen kind="loading" title="Загружаем статью…" />;

  const toggleLike = async () => {
    if (!signedIn) {
      navigate(loginUrl(currentPathWithSearch()));
      return;
    }
    try {
      const result = await setLike(post.id, !post.likedByMe);
      patch({ likedByMe: result.liked, likesCount: result.likesCount });
    } catch {
      /* the API layer already told the person why */
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deletePost(post.id);
      navigate("/blog?tab=mine", { replace: true });
    } catch {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className={`${styles.page} ${styles.article}`}>
      <Link to="/blog" className={styles.moreLink}>
        ← Все статьи
      </Link>

      {post.status !== "published" && (
        <div className={styles.notice} role="status">
          <strong>{POST_STATUS_LABELS[post.status]}.</strong>{" "}
          {post.status === "pending" && "Статью проверяет администратор: пока её видите только вы."}
          {post.status === "draft" && "Это черновик: его видите только вы."}
          {post.status === "rejected" && `Статью не опубликовали: ${post.rejectReason ?? "причина не указана"}. Исправьте её и отправьте снова.`}
          {post.status === "removed" && `Статью сняли: ${post.rejectReason ?? "причина не указана"}.`}
        </div>
      )}

      <div className={styles.articleHead}>
        <div>
          <span className={styles.sport}>{post.sport}</span>
          <h1>{post.title}</h1>
        </div>
        <PostMenu post={post} signedIn={signedIn} onChanged={patch} onDelete={() => setConfirmDelete(true)} />
      </div>

      <div className={styles.row} style={{ marginBottom: 12 }}>
        {post.author.profileOpen ? (
          <Link to={`/blog/authors/${post.author.id}`} className={styles.author}>
            <Avatar author={post.author} />
            <span className={styles.authorName}>
              {post.author.name}
              {post.author.isPro && <ProBadge />}
            </span>
          </Link>
        ) : (
          <span className={styles.author}>
            <Avatar author={post.author} />
            <span className={styles.authorName}>{post.author.name}</span>
          </span>
        )}
        <span className={styles.meta}>
          {formatPostDate(post.publishedAt)} · 👁 {post.viewsCount}
        </span>
      </div>

      <Carousel imageIds={post.imageIds} title={post.title} />
      <PostBody blocks={post.blocks} />

      {post.listing && (
        <div className={styles.listingCard}>
          {post.listing.photoFileId && <AuthenticatedImage token="" fileId={post.listing.photoFileId} alt="" className={styles.listingPhoto} thumb />}
          <div className={styles.listingInfo}>
            <p className={styles.listingTitle}>{post.listing.title}</p>
            <span className={styles.meta}>
              {post.author.name}
              {post.listing.pricePerSession !== null ? ` · ${post.listing.pricePerSession} ${post.listing.currency}` : ""}
            </span>
          </div>
          <Link to={`/coaches?listing=${post.listing.id}`} className={styles.primary}>
            Записаться
          </Link>
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={`${styles.like} ${post.likedByMe ? styles.likeOn : ""}`} aria-pressed={post.likedByMe} onClick={toggleLike}>
          {post.likedByMe ? "♥" : "♡"} {post.likesCount}
        </button>
        <span className={styles.meta}>💬 {post.commentsCount}</span>
      </div>

      {post.status === "published" && (
        <Comments postId={post.id} isPostAuthor={post.isMine} signedIn={signedIn} onCount={setCount} nextUrl={currentPathWithSearch()} />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Удалить статью?"
          description="Статья пропадёт у всех, вместе с комментариями. Это нельзя отменить."
          confirmLabel="Удалить"
          danger
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
