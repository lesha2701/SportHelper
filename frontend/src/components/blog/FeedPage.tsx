import { useCallback, useEffect, useState } from "react";
import {
  getBlogSettings,
  listMyPosts,
  listPosts,
  listSavedPosts,
  POST_STATUS_LABELS,
  saveBlogSettings,
  type FeedSort,
  type MyPost,
  type PostCard,
} from "../../api/blog";
import { useAuth } from "../../context/AuthContext";
import { loginUrl, navigate, useLocation } from "../../router";
import { COMMON_SPORTS } from "../../types/profile";
import { Link } from "../Link";
import { StateScreen } from "../StateScreen";
import { PostCardItem } from "./PostCardItem";
import { formatPostDate } from "./blogText";
import styles from "./blog.module.css";

type Tab = "all" | "mine" | "saved";
const PAGE = 20;

/** The news tab: every article (filter by sport, newest or most popular), the person's own articles and the ones they saved. */
export function FeedPage() {
  const { search } = useLocation();
  const { state } = useAuth();
  const signedIn = state.status === "ready";
  const params = new URLSearchParams(search);
  const requested = params.get("tab");
  const tab: Tab = signedIn && (requested === "mine" || requested === "saved") ? requested : "all";
  const sport = params.get("sport") ?? "";
  const sort: FeedSort = params.get("sort") === "popular" ? "popular" : "new";

  const change = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(search);
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    const text = merged.toString();
    navigate(`/blog${text ? `?${text}` : ""}`, { replace: true });
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>Статьи</h1>
        <Link to={signedIn ? "/blog/new" : loginUrl("/blog/new")} className={styles.primary}>
          Написать статью
        </Link>
      </div>

      <div className={styles.toolbar}>
        {signedIn && (
          <div className={styles.segmented} role="tablist" aria-label="Раздел">
            {([["all", "Все статьи"], ["mine", "Мои"], ["saved", "Сохранённые"]] as [Tab, string][]).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={`${styles.segment} ${tab === key ? styles.segmentOn : ""}`} onClick={() => change({ tab: key === "all" ? null : key })}>
                {label}
              </button>
            ))}
          </div>
        )}
        {tab === "all" && (
          <div className={styles.filters}>
            <select className={styles.filterSelect} aria-label="Вид спорта" value={sport} onChange={(e) => change({ sport: e.target.value || null })}>
              <option value="">Все виды спорта</option>
              {COMMON_SPORTS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select className={styles.filterSelect} aria-label="Порядок" value={sort} onChange={(e) => change({ sort: e.target.value === "new" ? null : e.target.value })}>
              <option value="new">Сначала новые</option>
              <option value="popular">Сначала популярные</option>
            </select>
          </div>
        )}
      </div>

      {tab === "all" && <AllPosts sport={sport} sort={sort} />}
      {tab === "mine" && <MyPosts />}
      {tab === "saved" && <SavedPosts />}
    </div>
  );
}

function AllPosts({ sport, sort }: { sport: string; sort: FeedSort }) {
  const [items, setItems] = useState<PostCard[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [more, setMore] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      try {
        const page = await listPosts({ sport: sport || null, sort, limit: PAGE, offset });
        setItems((current) => (offset === 0 ? page.items : [...current, ...page.items]));
        setTotal(page.total);
        setStatus("ready");
      } catch {
        setStatus("error");
      } finally {
        setMore(false);
      }
    },
    [sport, sort],
  );

  useEffect(() => {
    setStatus("loading");
    void load(0);
  }, [load]);

  return (
    <>
      {status === "loading" && <StateScreen kind="loading" title="Загружаем статьи…" />}
      {status === "error" && <StateScreen kind="error" title="Не удалось загрузить статьи" onRetry={() => void load(0)} />}
      {status === "ready" && items.length === 0 && <p className={styles.empty}>{sport ? `Статей про «${sport}» пока нет.` : "Статей пока нет."} Напишите первую!</p>}
      {status === "ready" && items.length > 0 && (
        <div className={styles.list}>
          {items.map((post) => (
            <PostCardItem key={post.id} post={post} />
          ))}
          {items.length < total && (
            <button
              type="button"
              className={styles.secondary}
              disabled={more}
              onClick={() => {
                setMore(true);
                void load(items.length);
              }}
            >
              Показать ещё
            </button>
          )}
        </div>
      )}
    </>
  );
}

function SavedPosts() {
  const [items, setItems] = useState<PostCard[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    listSavedPosts()
      .then((page) => setItems(page.items))
      .catch(() => setFailed(true));
  }, []);
  if (failed) return <StateScreen kind="error" title="Не удалось загрузить сохранённые статьи" />;
  if (!items) return <StateScreen kind="loading" title="Загружаем…" />;
  if (items.length === 0) return <p className={styles.empty}>Здесь будут статьи, которые вы сохранили («⋯» → «Сохранить»).</p>;
  return (
    <div className={styles.list}>
      {items.map((post) => (
        <PostCardItem key={post.id} post={post} />
      ))}
    </div>
  );
}

function MyPosts() {
  const [items, setItems] = useState<MyPost[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [settings, setSettings] = useState<{ showProfileInPosts: boolean; isCoach: boolean } | null>(null);

  useEffect(() => {
    listMyPosts()
      .then(setItems)
      .catch(() => setFailed(true));
    getBlogSettings()
      .then(setSettings)
      .catch(() => undefined);
  }, []);

  const toggleProfile = async (value: boolean) => {
    if (!settings) return;
    try {
      await saveBlogSettings(value);
      setSettings({ ...settings, showProfileInPosts: value });
    } catch {
      /* the API layer already told the person why */
    }
  };

  if (failed) return <StateScreen kind="error" title="Не удалось загрузить ваши статьи" />;
  if (!items) return <StateScreen kind="loading" title="Загружаем…" />;
  return (
    <>
      {settings && !settings.isCoach && (
        <label className={styles.check} style={{ marginBottom: 16 }}>
          <input type="checkbox" checked={settings.showProfileInPosts} onChange={(e) => void toggleProfile(e.target.checked)} />
          <span>
            Показывать мой профиль в статьях
            <br />
            <span className={styles.hint}>Если выключено, читатели видят только ваше имя. Если включено — ещё фото, вид спорта и ваши статьи.</span>
          </span>
        </label>
      )}
      {items.length === 0 && <p className={styles.empty}>Вы ещё ничего не написали.</p>}
      <div className={styles.list}>
        {items.map((post) => (
          <Link key={post.id} to={post.status === "draft" ? `/blog/${post.id}/edit` : `/blog/${post.id}`} className={styles.mineRow}>
            <div>
              <div className={styles.mineTitle}>{post.title}</div>
              <div className={styles.meta}>
                <span>{post.sport}</span>
                <span>{formatPostDate(post.publishedAt ?? post.updatedAt)}</span>
                {post.status === "published" && (
                  <>
                    <span>♥ {post.likesCount}</span>
                    <span>💬 {post.commentsCount}</span>
                    <span>👁 {post.viewsCount}</span>
                  </>
                )}
              </div>
              {post.status === "rejected" && post.rejectReason && <div className={styles.error}>{post.rejectReason}</div>}
            </div>
            <span className={styles.statusPill}>{POST_STATUS_LABELS[post.status]}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
