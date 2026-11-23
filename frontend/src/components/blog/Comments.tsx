import { useCallback, useEffect, useState, type FormEvent } from "react";
import { addComment, deleteComment, listComments, type PostAuthor, type PostComment } from "../../api/blog";
import { ApiError } from "../../api/client";
import { loginUrl } from "../../router";
import { Link } from "../Link";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { ReportButton } from "../shared/ReportButton";
import { formatPostDate } from "./blogText";
import styles from "./blog.module.css";

const MAX = 1000;

export function Avatar({ author }: { author: PostAuthor }) {
  if (author.avatarFileId) return <AuthenticatedImage token="" fileId={author.avatarFileId} alt="" className={styles.avatar} thumb />;
  return <span className={styles.avatarPlain}>{author.name.slice(0, 1).toUpperCase()}</span>;
}

/** Comments under an article. Everyone reads; a signed-in person writes. Contacts a person types are hidden by the server («[контакт скрыт]»). */
export function Comments({
  postId,
  isPostAuthor,
  signedIn,
  onCount,
  nextUrl,
}: {
  postId: string;
  /** The article's author may delete any comment under it. */
  isPostAuthor: boolean;
  signedIn: boolean;
  onCount: (count: number) => void;
  nextUrl: string;
}) {
  const [items, setItems] = useState<PostComment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listComments(postId)
      .then((list) => {
        setItems(list);
        setFailed(false);
        onCount(list.length);
      })
      .catch(() => setFailed(true));
  }, [postId, onCount]);

  useEffect(load, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const created = await addComment(postId, text);
      const next = [...(items ?? []), created];
      setItems(next);
      onCount(next.length);
      setText("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить комментарий");
    } finally {
      setSending(false);
    }
  };

  const remove = async (comment: PostComment) => {
    try {
      await deleteComment(comment.id);
      const next = (items ?? []).filter((c) => c.id !== comment.id);
      setItems(next);
      onCount(next.length);
    } catch {
      /* the API layer already told the person why */
    }
  };

  return (
    <section className={styles.comments} aria-label="Комментарии">
      <h2>Комментарии{items ? ` · ${items.length}` : ""}</h2>
      {signedIn ? (
        <form onSubmit={submit} className={styles.field}>
          <textarea
            className={styles.textarea}
            value={text}
            maxLength={MAX}
            placeholder="Напишите комментарий"
            aria-label="Ваш комментарий"
            onChange={(e) => setText(e.target.value)}
          />
          <span className={styles.hint}>Телефоны, почту и ссылки в комментариях мы скрываем. Реклама запрещена.</span>
          {error && <p className={styles.error}>{error}</p>}
          <div>
            <button type="submit" className={styles.primary} disabled={!text.trim() || sending}>
              {sending ? "Отправляем…" : "Отправить"}
            </button>
          </div>
        </form>
      ) : (
        <p className={styles.hint}>
          <Link to={loginUrl(nextUrl)} className={styles.moreLink}>
            Войдите
          </Link>
          , чтобы оставить комментарий.
        </p>
      )}
      {failed && <p className={styles.error}>Не удалось загрузить комментарии.</p>}
      {items?.length === 0 && <p className={styles.hint}>Пока никто не написал. Будьте первым.</p>}
      {items?.map((comment) => (
        <div key={comment.id} className={styles.comment}>
          <Avatar author={comment.author} />
          <div className={styles.commentBody}>
            <div className={styles.meta}>
              <strong className={styles.authorName}>{comment.author.name}</strong>
              <span>{formatPostDate(comment.createdAt)}</span>
            </div>
            <p className={styles.commentText}>{comment.body}</p>
            {signedIn && (
              <div className={styles.commentActions}>
                {(comment.isMine || isPostAuthor) && (
                  <button type="button" className={styles.linkButton} onClick={() => remove(comment)}>
                    Удалить
                  </button>
                )}
                {!comment.isMine && (
                  <ReportButton targetType="post_comment" targetId={comment.id} ownerUserId={comment.author.id} label="Пожаловаться" className={styles.linkButton} />
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
