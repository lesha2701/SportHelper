import { useEffect, useState } from "react";
import {
  approveAdminPost,
  getAdminPost,
  hideAdminComment,
  listAdminPosts,
  rejectAdminPost,
  removeAdminPost,
  restoreAdminPost,
  setAuthorTrusted,
  type AdminPost,
  type AdminPostRow,
} from "../../api/admin";
import { listComments, POST_STATUS_LABELS, type PostComment } from "../../api/blog";
import { ApiError } from "../../api/client";
import { Link } from "../Link";
import { PostBody } from "../blog/blogText";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { Icon } from "../shared/Icon";
import { ErrorBox, PageHead, Pager, Pill, ReasonDialog, errorText, formatDateTime, useAdminQuery, useDebounced, useOpenParam } from "./adminUi";
import styles from "./admin.module.css";

const PAGE_SIZE = 25;
const FLAG_LABELS: Record<string, string> = { promo_words: "Есть слова вроде «скидка», «промокод», «записывайтесь»: проверьте, не реклама ли" };

function StatusPill({ status }: { status: AdminPostRow["status"] }) {
  return <Pill tone={status === "pending" ? "warn" : status === "published" ? "ok" : status === "draft" ? "neutral" : "bad"}>{POST_STATUS_LABELS[status]}</Pill>;
}

/** «Статьи»: the articles waiting for approval come first (oldest first). Approve, reject with a reason, take a published one down, restore it;
 *  hide a comment; mark an author as trusted so his articles go live after the automatic check alone. */
export function BlogPostsPage() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("pending");
  const [withComplaints, setWithComplaints] = useState(false);
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useOpenParam();
  const q = useDebounced(text);

  useEffect(() => setOffset(0), [q, status, withComplaints]);
  const { query, reload } = useAdminQuery(() => listAdminPosts({ status, q, withComplaints, limit: PAGE_SIZE, offset }), [status, q, withComplaints, offset]);

  return (
    <>
      <PageHead title="Статьи" hint="Статьи блога. Сначала те, что ждут проверки. Фото и текст смотрите внимательно: контакты автопроверка отсекает, а рекламу и неподобающие фото — только вы." />
      <div className={styles.chips} role="group" aria-label="Статус статьи">
        {(["pending", "published", "rejected", "removed", ""] as const).map((s) => (
          <button key={s || "all"} type="button" className={status === s ? styles.chipActive : styles.chip} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s ? POST_STATUS_LABELS[s] : "Все"}
          </button>
        ))}
        <button type="button" className={withComplaints ? styles.chipActive : styles.chip} aria-pressed={withComplaints} onClick={() => setWithComplaints((v) => !v)}>
          С жалобами
        </button>
      </div>
      <div className={styles.toolbar}>
        <input className={styles.input} type="search" placeholder="Заголовок, текст, email автора" value={text} maxLength={100} onChange={(e) => setText(e.target.value)} aria-label="Поиск статей" />
      </div>

      {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
      {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
      {query.status === "ready" && (
        <>
          <div className={styles.tableWrap}>
            {query.data.items.length === 0 ? (
              <div className={styles.empty}>Статей нет.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Статья</th>
                    <th>Автор</th>
                    <th>Статус</th>
                    <th>Отправлена</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((p) => (
                    <tr key={p.id} className={styles.rowClickable} tabIndex={0} onClick={() => setOpenId(p.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(p.id)}>
                      <td>
                        <strong>{p.title}</strong>
                        <span className={styles.muted}> · {p.sport}</span>
                        {p.flags.length > 0 && <Pill tone="warn">проверить</Pill>}
                        {p.openComplaints > 0 && <Pill tone="bad">жалоб: {p.openComplaints}</Pill>}
                      </td>
                      <td>
                        {p.authorEmail ?? p.authorName}
                        {p.authorTrusted && <span className={styles.muted}> · доверенный</span>}
                      </td>
                      <td>
                        <StatusPill status={p.status} />
                      </td>
                      <td>{formatDateTime(p.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pager total={query.data.total} offset={offset} limit={PAGE_SIZE} onChange={setOffset} />
        </>
      )}
      {openId && <PostDrawer id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

type Decision = "reject" | "remove" | null;

function PostDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [post, setPost] = useState<AdminPost | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [deciding, setDeciding] = useState<Decision>(null);
  const [hiding, setHiding] = useState<PostComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    getAdminPost(id)
      .then((loaded) => {
        setPost(loaded);
        setFailed(null);
        if (loaded.status === "published") listComments(id).then(setComments).catch(() => undefined);
        else setComments([]);
      })
      .catch((err) => setFailed(errorText(err)));
  };
  useEffect(load, [id]);

  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDeciding(null);
      setHiding(null);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleTrusted = async () => {
    if (!post) return;
    await perform(() => setAuthorTrusted(post.authorId, !post.authorTrusted));
  };

  return (
    <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className={styles.drawer} aria-label="Статья">
        <div className={styles.drawerHead}>
          <h2 className={styles.cardTitle} style={{ margin: 0 }}>
            Статья
          </h2>
          <button type="button" className={styles.button} onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>
        {failed && <ErrorBox message={failed} onRetry={load} />}
        {!post && !failed && <p className={styles.pageHint}>Загрузка…</p>}
        {post && (
          <>
            <section className={styles.card}>
              <dl className={styles.kv}>
                <dt>Статус</dt>
                <dd>
                  <StatusPill status={post.status} />
                </dd>
                <dt>Автор</dt>
                <dd>
                  <Link to={`/admin/users?open=${post.authorId}`} className={styles.link}>
                    {post.authorName}
                  </Link>{" "}
                  <span className={styles.muted}>{post.authorEmail}</span>
                </dd>
                <dt>Вид спорта</dt>
                <dd>{post.sport}</dd>
                <dt>Отправлена</dt>
                <dd>{formatDateTime(post.submittedAt)}</dd>
                {post.reviewedBy && (
                  <>
                    <dt>Решение</dt>
                    <dd>
                      {post.reviewedBy}
                      {post.rejectReason ? `: ${post.rejectReason}` : ""}
                    </dd>
                  </>
                )}
                {post.status === "published" && (
                  <>
                    <dt>Читатели</dt>
                    <dd>
                      ♥ {post.likesCount} · 💬 {post.commentsCount}
                    </dd>
                  </>
                )}
              </dl>
              {post.flags.map((flag) => (
                <p key={flag} className={styles.pageHint} style={{ color: "var(--color-warning)" }}>
                  ⚠ {FLAG_LABELS[flag] ?? flag}
                </p>
              ))}
              <label className={styles.ack} style={{ marginTop: 12 }}>
                <input type="checkbox" checked={post.authorTrusted} disabled={busy} onChange={() => void toggleTrusted()} />
                <span>Без модерации администратором: статьи этого автора публикуются сразу после автопроверки</span>
              </label>
            </section>

            <section className={styles.card}>
              <h3 className={styles.cardTitle}>{post.title}</h3>
              {post.imageIds.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  {post.imageIds.map((fileId, index) => (
                    <AuthenticatedImage
                      key={fileId}
                      token=""
                      fileId={fileId}
                      alt={`Фото ${index + 1}`}
                      className={styles.thumbImg}
                      zoomable
                      gallery={post.imageIds.map((f) => ({ kind: "image" as const, fileId: f, alt: post.title }))}
                      galleryIndex={index}
                    />
                  ))}
                </div>
              )}
              <PostBody blocks={post.blocks} />
            </section>

            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.dialogActions} style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
              {post.status === "pending" && (
                <>
                  <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => void perform(() => approveAdminPost(post.id))}>
                    Опубликовать
                  </button>
                  <button type="button" className={styles.buttonDanger} disabled={busy} onClick={() => setDeciding("reject")}>
                    Отклонить
                  </button>
                </>
              )}
              {post.status === "published" && (
                <button type="button" className={styles.buttonDanger} disabled={busy} onClick={() => setDeciding("remove")}>
                  Снять статью
                </button>
              )}
              {(post.status === "removed" || post.status === "rejected") && (
                <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => void perform(() => restoreAdminPost(post.id))}>
                  Вернуть на сайт
                </button>
              )}
            </div>

            {comments.length > 0 && (
              <section className={styles.card}>
                <h3 className={styles.cardTitle}>Комментарии</h3>
                {comments.map((comment) => (
                  <div key={comment.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0" }}>
                    <div>
                      <strong>{comment.author.name}</strong>
                      <div style={{ whiteSpace: "pre-wrap" }}>{comment.body}</div>
                    </div>
                    <button type="button" className={styles.button} onClick={() => setHiding(comment)}>
                      Скрыть
                    </button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </aside>

      {post && deciding && (
        <ReasonDialog
          title={deciding === "reject" ? "Отклонить статью" : "Снять статью"}
          description="Автор получит уведомление с этой причиной. Напишите так, чтобы по ней можно было исправить статью."
          confirmLabel={deciding === "reject" ? "Отклонить" : "Снять"}
          danger
          busy={busy}
          error={error}
          onClose={() => setDeciding(null)}
          onConfirm={(reason) => void perform(() => (deciding === "reject" ? rejectAdminPost(post.id, reason) : removeAdminPost(post.id, reason)))}
        />
      )}
      {hiding && (
        <ReasonDialog
          title="Скрыть комментарий"
          description={hiding.body}
          confirmLabel="Скрыть"
          danger
          busy={busy}
          error={error}
          onClose={() => setHiding(null)}
          onConfirm={(reason) => void perform(() => hideAdminComment(hiding.id, reason))}
        />
      )}
    </div>
  );
}
