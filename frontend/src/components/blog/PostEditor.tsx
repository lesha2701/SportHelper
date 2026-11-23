import { useEffect, useRef, useState } from "react";
import {
  BODY_MAX,
  BODY_MIN,
  createPost,
  getBlogSettings,
  getPost,
  MAX_POST_IMAGES,
  saveBlogSettings,
  TITLE_MAX,
  TITLE_MIN,
  updatePost,
  uploadPostImage,
  type BlockType,
  type Post,
  type PostBlock,
  type PostInput,
} from "../../api/blog";
import { ApiError } from "../../api/client";
import { listMyListings } from "../../api/coachListings";
import { navigate } from "../../router";
import type { CoachListing } from "../../types/coachListing";
import { Link } from "../Link";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { SportSelect } from "../shared/SportSelect";
import { StateScreen } from "../StateScreen";
import { PostBody, blocksLength, wrapSelection } from "./blogText";
import styles from "./blog.module.css";

const BLOCK_LABELS: Record<BlockType, string> = { paragraph: "Абзац", heading: "Заголовок", quote: "Цитата", list: "Список" };
const BLOCK_TYPES = Object.keys(BLOCK_LABELS) as BlockType[];

/** One block as the editor holds it: lists are edited as lines of text, one item per line. */
interface DraftBlock {
  key: number;
  type: BlockType;
  text: string;
}

let nextKey = 1;
const newBlock = (type: BlockType = "paragraph", text = ""): DraftBlock => ({ key: nextKey++, type, text });

/** A copy of the list with two places swapped (nothing changes when either place does not exist). */
function swapped<T>(list: T[], a: number, b: number): T[] {
  const first = list[a];
  const second = list[b];
  if (first === undefined || second === undefined) return list;
  const copy = [...list];
  copy[a] = second;
  copy[b] = first;
  return copy;
}

const toBlocks = (drafts: DraftBlock[]): PostBlock[] =>
  drafts
    .map((d): PostBlock => (d.type === "list" ? { type: "list", items: d.text.split("\n").map((s) => s.trim()).filter(Boolean) } : { type: d.type, text: d.text.trim() }))
    .filter((b) => (b.type === "list" ? (b.items ?? []).length > 0 : (b.text ?? "") !== ""));

const fromBlocks = (blocks: PostBlock[]): DraftBlock[] =>
  blocks.length ? blocks.map((b) => newBlock(b.type, b.type === "list" ? (b.items ?? []).join("\n") : (b.text ?? ""))) : [newBlock()];

/** Writing and editing an article. The text is a list of blocks (paragraph, heading, quote, list) with **bold** and *italic*; up to three photos;
 *  a trainer may attach one of his listings. «Отправить» runs the automatic check on the server and shows what it refused, if anything. */
export function PostEditor({ postId, feedUrl }: { postId: string | null; feedUrl: string }) {
  const [loaded, setLoaded] = useState<"loading" | "ready" | "failed" | "forbidden">(postId ? "loading" : "ready");
  const [existing, setExisting] = useState<Post | null>(null);
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState("");
  const [blocks, setBlocks] = useState<DraftBlock[]>(() => [newBlock()]);
  const [images, setImages] = useState<string[]>([]);
  const [listingId, setListingId] = useState<string>("");
  const [listings, setListings] = useState<CoachListing[]>([]);
  const [isCoach, setIsCoach] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areas = useRef(new Map<number, HTMLTextAreaElement>());

  useEffect(() => {
    getBlogSettings()
      .then((s) => {
        setIsCoach(s.isCoach);
        setShowProfile(s.showProfileInPosts);
        if (s.isCoach) listMyListings("").then((list) => setListings(list.filter((l) => l.isListed))).catch(() => undefined);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    getPost(postId)
      .then((post) => {
        if (cancelled) return;
        if (!post.isMine || post.status === "removed") {
          setLoaded("forbidden");
          return;
        }
        setExisting(post);
        setTitle(post.title);
        setSport(post.sport);
        setBlocks(fromBlocks(post.blocks));
        setImages(post.imageIds);
        setListingId(post.listing?.id ?? "");
        setLoaded("ready");
      })
      .catch(() => !cancelled && setLoaded("failed"));
    return () => {
      cancelled = true;
    };
  }, [postId]);

  if (loaded === "loading") return <StateScreen kind="loading" title="Загружаем статью…" />;
  if (loaded === "failed") return <StateScreen kind="error" title="Не удалось открыть статью" />;
  if (loaded === "forbidden") return <StateScreen kind="error" title="Эту статью нельзя изменить" description="Она не ваша или её сняли администраторы." />;

  const length = blocksLength(toBlocks(blocks));
  const isLive = existing?.status === "published" || existing?.status === "pending";

  const update = (key: number, change: Partial<DraftBlock>) => setBlocks((list) => list.map((b) => (b.key === key ? { ...b, ...change } : b)));
  const move = (index: number, step: number) => setBlocks((list) => swapped(list, index, index + step));
  const remove = (key: number) => setBlocks((list) => (list.length > 1 ? list.filter((b) => b.key !== key) : [newBlock()]));

  const mark = (key: number, marker: string) => {
    const area = areas.current.get(key);
    const block = blocks.find((b) => b.key === key);
    if (!area || !block) return;
    const result = wrapSelection(block.text, area.selectionStart, area.selectionEnd, marker);
    update(key, { text: result.value });
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(result.start, result.end);
    });
  };

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      let next = images;
      for (const file of Array.from(files)) {
        if (next.length >= MAX_POST_IMAGES) break;
        next = [...next, await uploadPostImage(file)];
        setImages(next);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить фото");
    } finally {
      setUploading(false);
    }
  };

  const moveImage = (index: number, step: number) => setImages((list) => swapped(list, index, index + step));

  const save = async (submit: boolean) => {
    setSaving(true);
    setError(null);
    const input: PostInput = { title: title.trim(), sport, blocks: toBlocks(blocks), imageIds: images, listingId: listingId || null, submit };
    try {
      const saved = existing ? await updatePost(existing.id, input) : await createPost(input);
      navigate(`/blog/${saved.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить статью");
      setSaving(false);
    }
  };

  const draftBlocks = toBlocks(blocks);

  return (
    <div className={styles.page}>
      <Link to={existing ? `/blog/${existing.id}` : feedUrl} className={styles.moreLink}>
        ← Назад
      </Link>
      <h1 className={styles.title} style={{ margin: "12px 0 16px" }}>
        {existing ? "Изменить статью" : "Новая статья"}
      </h1>

      {isLive && (
        <p className={styles.notice}>
          После сохранения статья снова пройдёт проверку: пока администратор её не посмотрит, читатели её не увидят.
          {" "}Если вы доверенный автор, она останется на сайте.
        </p>
      )}

      <label className={styles.field}>
        <span className={styles.label}>Заголовок</span>
        <input className={styles.input} value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder="О чём статья" />
        <span className={styles.hint}>{title.trim().length < TITLE_MIN ? `Не короче ${TITLE_MIN} знаков` : `${title.trim().length} из ${TITLE_MAX}`}</span>
      </label>

      <SportSelect value={sport} onChange={setSport} label="Вид спорта" placeholder="Выберите вид спорта" />

      <div className={styles.field}>
        <span className={styles.label}>
          Фото (до {MAX_POST_IMAGES}) — листаются каруселью над текстом
        </span>
        <div className={styles.thumbs}>
          {images.map((id, index) => (
            <div key={id} className={styles.thumb}>
              <AuthenticatedImage token="" fileId={id} alt={`Фото ${index + 1}`} className={styles.thumbImg} thumb />
              <div className={styles.thumbBar}>
                <button type="button" className={styles.toolButton} disabled={index === 0} aria-label="Сдвинуть влево" onClick={() => moveImage(index, -1)}>
                  ←
                </button>
                <button type="button" className={styles.toolButton} aria-label="Убрать фото" onClick={() => setImages((list) => list.filter((x) => x !== id))}>
                  ✕
                </button>
                <button type="button" className={styles.toolButton} disabled={index === images.length - 1} aria-label="Сдвинуть вправо" onClick={() => moveImage(index, 1)}>
                  →
                </button>
              </div>
            </div>
          ))}
        </div>
        {images.length < MAX_POST_IMAGES && (
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={(e) => { void addImages(e.target.files); e.target.value = ""; }} aria-label="Добавить фото" />
        )}
        {uploading && <span className={styles.hint}>Загружаем…</span>}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Текст</span>
        {blocks.map((block, index) => (
          <div key={block.key} className={styles.block}>
            <div className={styles.blockBar}>
              <select className={styles.select} style={{ width: "auto" }} value={block.type} aria-label="Тип блока" onChange={(e) => update(block.key, { type: e.target.value as BlockType })}>
                {BLOCK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {BLOCK_LABELS[t]}
                  </option>
                ))}
              </select>
              <button type="button" className={styles.toolButton} disabled={block.type === "list"} aria-label="Жирный" title="Жирный" onClick={() => mark(block.key, "**")}>
                <strong>Ж</strong>
              </button>
              <button type="button" className={styles.toolButton} aria-label="Курсив" title="Курсив" onClick={() => mark(block.key, "*")}>
                <em>К</em>
              </button>
              <span className={styles.spacer} />
              <button type="button" className={styles.toolButton} disabled={index === 0} aria-label="Блок выше" onClick={() => move(index, -1)}>
                ↑
              </button>
              <button type="button" className={styles.toolButton} disabled={index === blocks.length - 1} aria-label="Блок ниже" onClick={() => move(index, 1)}>
                ↓
              </button>
              <button type="button" className={styles.toolButton} aria-label="Удалить блок" onClick={() => remove(block.key)}>
                ✕
              </button>
            </div>
            <textarea
              ref={(el) => {
                if (el) areas.current.set(block.key, el);
                else areas.current.delete(block.key);
              }}
              className={styles.textarea}
              value={block.text}
              maxLength={5000}
              aria-label={BLOCK_LABELS[block.type]}
              placeholder={block.type === "list" ? "Один пункт — одна строка" : block.type === "heading" ? "Заголовок раздела" : "Текст"}
              onChange={(e) => update(block.key, { text: e.target.value })}
            />
          </div>
        ))}
        <div className={styles.row}>
          <button type="button" className={styles.secondary} onClick={() => setBlocks((list) => [...list, newBlock()])}>
            + Добавить блок
          </button>
          <button type="button" className={styles.secondary} onClick={() => setPreview((v) => !v)} aria-pressed={preview}>
            {preview ? "Скрыть предпросмотр" : "Предпросмотр"}
          </button>
        </div>
        <span className={styles.hint}>
          Знаков: {length} (нужно от {BODY_MIN} до {BODY_MAX}). Жирный — выделите текст и нажмите «Ж», курсив — «К». Телефоны, почту, ссылки и ники указывать нельзя.
        </span>
      </div>

      {preview && (
        <div className={styles.block} aria-label="Предпросмотр">
          <h2 style={{ margin: "0 0 12px" }}>{title || "Без названия"}</h2>
          <PostBody blocks={draftBlocks} />
        </div>
      )}

      {isCoach && listings.length > 0 && (
        <label className={styles.field}>
          <span className={styles.label}>Карточка вашего объявления под статьёй (с кнопкой «Записаться»)</span>
          <select className={styles.select} value={listingId} onChange={(e) => setListingId(e.target.value)}>
            <option value="">Не прикреплять</option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
      )}

      {!isCoach && (
        <label className={styles.check} style={{ marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={showProfile}
            onChange={(e) => {
              setShowProfile(e.target.checked);
              void saveBlogSettings(e.target.checked).catch(() => setShowProfile(!e.target.checked));
            }}
          />
          <span>
            Показывать мой профиль в статьях
            <br />
            <span className={styles.hint}>Иначе читатели увидят только ваше имя.</span>
          </span>
        </label>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.row}>
        <button type="button" className={styles.primary} disabled={saving || uploading} onClick={() => void save(true)}>
          {saving ? "Сохраняем…" : isLive ? "Сохранить изменения" : "Отправить на проверку"}
        </button>
        {!isLive && (
          <button type="button" className={styles.secondary} disabled={saving || uploading} onClick={() => void save(false)}>
            Сохранить черновик
          </button>
        )}
      </div>
    </div>
  );
}
