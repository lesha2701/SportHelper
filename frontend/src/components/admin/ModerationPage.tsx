import { useEffect, useState } from "react";
import {
  deleteAdminMedia,
  fetchAdminMediaBlob,
  getAdminMedia,
  hideAdminMedia,
  listAdminMedia,
  restoreAdminMedia,
  type AdminMedia,
  type AdminMediaDetail,
  type MediaKind,
  type MediaState,
} from "../../api/admin";
import { ApiError } from "../../api/client";
import { toast } from "../../toast";
import { Link } from "../Link";
import { Icon } from "../shared/Icon";
import { ErrorBox, PageHead, Pager, Pill, ReasonDialog, errorText, formatDate, formatDateTime, useAdminQuery, useBlobUrl, useDebounced, useOpenParam } from "./adminUi";
import { StepUpCancelled, useStepUp } from "./stepUp";
import styles from "./admin.module.css";

const PAGE_SIZE = 24;

export const KIND_LABELS: Record<MediaKind | "other", string> = {
  avatar: "Аватар",
  logo: "Логотип команды",
  listing: "Фото/видео объявления",
  gallery: "Достижения",
  exercise: "Упражнение",
  training: "Тренировки и задания",
  other: "Другое",
};

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

/** A moderator's thumbnail: fetched through the admin route so hidden files can be seen too. */
function AdminThumb({ media }: { media: Pick<AdminMedia, "id" | "mediaType" | "hasThumb" | "filename"> }) {
  const isImage = media.mediaType === "image";
  const { url, failed } = useBlobUrl(() => (isImage ? fetchAdminMediaBlob(media.id, media.hasThumb ? "thumb" : undefined) : Promise.reject(new Error("no preview"))), [media.id]);
  if (url) return <img className={styles.mediaThumb} src={url} alt={media.filename} loading="lazy" />;
  return (
    <div className={styles.mediaTilePlaceholder} aria-hidden="true">
      <Icon name={isImage && !failed ? "image" : "video"} size={28} />
    </div>
  );
}

export function ModerationPage() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<MediaKind | "">("");
  const [mediaType, setMediaType] = useState<"image" | "video" | "">("");
  const [state, setState] = useState<MediaState | "">("");
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useOpenParam();
  const q = useDebounced(search);

  useEffect(() => setOffset(0), [q, kind, mediaType, state]);
  const { query, reload } = useAdminQuery(() => listAdminMedia({ q, kind, mediaType, state, limit: PAGE_SIZE, offset }), [q, kind, mediaType, state, offset]);

  return (
    <>
      <PageHead
        title="Модерация"
        hint="Фото и видео пользователей. Сначала скрывайте — файл пропадёт с сайта, но его можно вернуть. Удаление необратимо."
      />
      <div className={styles.toolbar}>
        <input className={styles.input} type="search" placeholder="Автор (email, имя, ID) или имя файла" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск по автору" />
        <select className={styles.select} value={kind} onChange={(e) => setKind(e.target.value as MediaKind | "")} aria-label="Тип материала">
          <option value="">Все материалы</option>
          {(["avatar", "logo", "listing", "gallery", "exercise", "training"] as MediaKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select className={styles.select} value={mediaType} onChange={(e) => setMediaType(e.target.value as "image" | "video" | "")} aria-label="Фото или видео">
          <option value="">Фото и видео</option>
          <option value="image">Фото</option>
          <option value="video">Видео</option>
        </select>
        <select className={styles.select} value={state} onChange={(e) => setState(e.target.value as MediaState | "")} aria-label="Состояние">
          <option value="">Любое состояние</option>
          <option value="visible">На сайте</option>
          <option value="hidden">Скрытые</option>
        </select>
      </div>

      {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
      {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
      {query.status === "ready" && (
        <>
          {query.data.items.length === 0 ? (
            <div className={styles.card}>
              <div className={styles.empty}>Ничего не найдено. Измените запрос или фильтры.</div>
            </div>
          ) : (
            <div className={styles.mediaGrid}>
              {query.data.items.map((media) => (
                <button key={media.id} type="button" className={styles.mediaTile} onClick={() => setOpenId(media.id)} aria-label={`Открыть: ${media.filename}`}>
                  <span className={styles.thumbWrap}>
                    <AdminThumb media={media} />
                    {media.hidden && (
                      <span className={styles.hiddenMark}>
                        <Pill tone="bad">Скрыто</Pill>
                      </span>
                    )}
                  </span>
                  <span className={styles.mediaMeta}>
                    <strong>{KIND_LABELS[media.kind]}</strong>
                    <span className={styles.muted}>{media.owner.name || media.owner.email || "—"}</span>
                    <span className={styles.muted}>
                      {formatSize(media.sizeBytes)} · {formatDate(media.createdAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <Pager total={query.data.total} offset={offset} limit={PAGE_SIZE} onChange={setOffset} />
        </>
      )}

      {openId && <MediaDrawer mediaId={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

type Dialog = "hide" | "restore" | "delete" | null;

function MediaDrawer({ mediaId, onClose, onChanged }: { mediaId: string; onClose: () => void; onChanged: () => void }) {
  const { query, reload } = useAdminQuery(() => getAdminMedia(mediaId), [mediaId]);
  const stepUp = useStepUp();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = () => {
    setDialog(null);
    reload();
    onChanged();
  };

  const perform = async (action: () => Promise<unknown>, after: () => void = finish) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      after();
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) setError(err instanceof ApiError ? err.message : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const media = query.status === "ready" ? query.data : null;

  return (
    <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className={styles.drawer} aria-label="Карточка материала">
        <div className={styles.drawerHead}>
          <h2 className={styles.cardTitle} style={{ margin: 0 }}>
            Материал
          </h2>
          <button type="button" className={styles.button} onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>

        {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
        {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
        {media && (
          <>
            <Preview media={media} />
            <section className={styles.card}>
              <dl className={styles.kv}>
                <dt>Материал</dt>
                <dd>{KIND_LABELS[media.kind]}</dd>
                <dt>Автор</dt>
                <dd>
                  <Link to={`/admin/users?open=${media.owner.id}`} className={styles.link}>
                    {media.owner.name || "Без имени"}
                  </Link>{" "}
                  <span className={styles.muted}>{media.owner.email}</span>
                </dd>
                {media.related && (
                  <>
                    <dt>Связано с</dt>
                    <dd>
                      <RelatedLink related={media.related} />
                    </dd>
                  </>
                )}
                <dt>Файл</dt>
                <dd>
                  {media.filename} · {formatSize(media.sizeBytes)} · {media.mimeType}
                </dd>
                <dt>Загружен</dt>
                <dd>{formatDateTime(media.createdAt)}</dd>
                <dt>Состояние</dt>
                <dd>{media.hidden ? <Pill tone="bad">Скрыт с сайта</Pill> : <Pill tone="ok">На сайте</Pill>}</dd>
                {media.hidden && (
                  <>
                    <dt>Причина</dt>
                    <dd>
                      {media.moderationReason} <span className={styles.muted}>— {media.hiddenBy ?? "—"}, {formatDateTime(media.hiddenAt)}</span>
                    </dd>
                  </>
                )}
                <dt>Жалобы</dt>
                <dd>
                  {media.openComplaints > 0 ? (
                    <Link to={`/admin/reports?q=${media.id}`} className={styles.link}>
                      Открытых: {media.openComplaints}
                    </Link>
                  ) : (
                    "нет открытых"
                  )}
                </dd>
              </dl>
            </section>

            <div className={styles.actions}>
              {media.hidden ? (
                <button type="button" className={styles.buttonPrimary} onClick={() => { setError(null); setDialog("restore"); }}>
                  Восстановить на сайте
                </button>
              ) : (
                <button type="button" className={styles.buttonDanger} onClick={() => { setError(null); setDialog("hide"); }}>
                  Скрыть с сайта
                </button>
              )}
              <button type="button" className={styles.button} onClick={() => { setError(null); setDialog("delete"); }}>
                <Icon name="trash" size={15} />
                Удалить файл
              </button>
            </div>
          </>
        )}

        {dialog === "hide" && (
          <ReasonDialog
            title="Скрыть с сайта"
            description="Файл перестанет показываться всем, включая владельца. Его можно будет восстановить."
            confirmLabel="Скрыть"
            danger
            busy={busy}
            error={error}
            onConfirm={(reason) => void perform(() => hideAdminMedia(mediaId, reason))}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === "restore" && (
          <ReasonDialog title="Восстановить файл" confirmLabel="Восстановить" busy={busy} error={error} onConfirm={(reason) => void perform(() => restoreAdminMedia(mediaId, reason))} onClose={() => setDialog(null)} />
        )}
        {dialog === "delete" && (
          <ReasonDialog
            title="Удалить файл из хранилища"
            description="Файл будет убран с сайта и удалён с Яндекс Диска. Это необратимо. Если файл используется ещё где-то, система откажет."
            confirmLabel="Удалить навсегда"
            danger
            busy={busy}
            error={error}
            acknowledge="Я понимаю, что восстановить файл будет нельзя"
            onConfirm={(reason) =>
              void perform(
                () => stepUp.run(() => deleteAdminMedia(mediaId, reason)),
                () => {
                  toast.success("Файл удалён");
                  setDialog(null);
                  onChanged();
                  onClose();
                },
              )
            }
            onClose={() => setDialog(null)}
          />
        )}
      </aside>
    </div>
  );
}

function RelatedLink({ related }: { related: NonNullable<AdminMediaDetail["related"]> }) {
  if (related.type === "user") {
    return (
      <Link to={`/admin/users?open=${related.id}`} className={styles.link}>
        {related.label}
      </Link>
    );
  }
  if (related.type === "listing") {
    return (
      <Link to={`/admin/trainings?tab=listings&open=${related.id}`} className={styles.link}>
        {related.label}
      </Link>
    );
  }
  return <span>{related.label}</span>;
}

function Preview({ media }: { media: AdminMedia }) {
  const { url, failed } = useBlobUrl(() => fetchAdminMediaBlob(media.id), [media.id]);
  if (failed) return <div className={styles.error}>Не удалось загрузить файл (возможно, его уже нет в хранилище).</div>;
  if (!url) return <div className={styles.chartEmpty}>Загрузка файла…</div>;
  return media.mediaType === "video" ? <video className={styles.mediaPreview} src={url} controls playsInline /> : <img className={styles.mediaPreview} src={url} alt={media.filename} />;
}
