import { useEffect, useRef, useState } from "react";
import { setAuthorMuted, setBookmark, setPostHidden, type Post } from "../../api/blog";
import { toast } from "../../toast";
import { navigate } from "../../router";
import { ReportButton } from "../shared/ReportButton";
import styles from "./blog.module.css";

/** The «three dots» of an article. A reader: save, copy the link, hide the article, hide the author, report. The author: edit, delete. */
export function PostMenu({
  post,
  signedIn,
  onChanged,
  onDelete,
}: {
  post: Post;
  signedIn: boolean;
  onChanged: (patch: Partial<Post>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const copyLink = async () => {
    setOpen(false);
    const url = `${window.location.origin}/blog/${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Ссылка скопирована");
    } catch {
      window.prompt("Скопируйте ссылку", url);
    }
  };

  const act = async (run: () => Promise<unknown>, after?: () => void) => {
    setOpen(false);
    try {
      await run();
      after?.();
    } catch {
      /* the API layer already told the person why */
    }
  };

  return (
    <div className={styles.menuWrap} ref={wrap}>
      <button type="button" className={styles.menuButton} aria-label="Ещё" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        ⋯
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {post.status === "published" && (
            <button type="button" role="menuitem" className={styles.menuItem} onClick={copyLink}>
              Скопировать ссылку
            </button>
          )}
          {post.isMine ? (
            <>
              <button type="button" role="menuitem" className={styles.menuItem} onClick={() => navigate(`/blog/${post.id}/edit`)}>
                Изменить
              </button>
              <button
                type="button"
                role="menuitem"
                className={`${styles.menuItem} ${styles.menuDanger}`}
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                Удалить
              </button>
            </>
          ) : (
            signedIn && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => act(() => setBookmark(post.id, !post.bookmarkedByMe), () => onChanged({ bookmarkedByMe: !post.bookmarkedByMe }))}
                >
                  {post.bookmarkedByMe ? "Убрать из сохранённых" : "Сохранить"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => act(() => setPostHidden(post.id, true), () => navigate("/blog"))}
                >
                  Скрыть статью
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => act(() => setAuthorMuted(post.author.id, true), () => navigate("/blog"))}
                >
                  Скрыть автора
                </button>
                <div role="menuitem">
                  <ReportButton targetType="post" targetId={post.id} ownerUserId={post.author.id} label="Пожаловаться" className={styles.menuItem} />
                </div>
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}
