import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { loginUrl, navigate, useLocation } from "../../router";
import { PublicShell } from "../public/PublicShell";
import { AuthorPage } from "./AuthorPage";
import { FeedPage } from "./FeedPage";
import { PostEditor } from "./PostEditor";
import { PostPage } from "./PostPage";

export function BlogApp({ path, embedded = false }: { path: string; embedded?: boolean }) {
  const { state } = useAuth();
  const { search } = useLocation();
  const signedIn = state.status === "ready";
  const [, second, third] = path.split("/").filter(Boolean);
  const isFeed = !second;
  const needsLogin = second === "new" || third === "edit";
  const [lastFeedSearch, setLastFeedSearch] = useState<string | null>(isFeed ? search : null);
  const [feedRevision, setFeedRevision] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const feedPosition = useRef({ search, top: 0 });

  useEffect(() => {
    if (needsLogin && !signedIn) navigate(loginUrl(path), { replace: true });
  }, [needsLogin, signedIn, path]);

  useLayoutEffect(() => {
    const scroller = root.current?.closest<HTMLElement>("[data-workspace-scroll]") ?? window;
    if (!isFeed) {
      scroller.scrollTo?.(0, 0);
      return;
    }
    if (feedPosition.current.search !== search) feedPosition.current = { search, top: 0 };
    scroller.scrollTo?.(0, feedPosition.current.top);
    const remember = () => {
      feedPosition.current.top = scroller instanceof HTMLElement ? scroller.scrollTop : scroller.scrollY;
    };
    scroller.addEventListener("scroll", remember, { passive: true });
    setLastFeedSearch(search);
    return () => scroller.removeEventListener("scroll", remember);
  }, [isFeed, path, search]);

  const feedUrl = `/blog${lastFeedSearch ?? ""}`;
  const refreshFeed = () => setFeedRevision((value) => value + 1);
  let page = null;
  if (second === "new") {
    if (signedIn) page = <PostEditor key="new" postId={null} feedUrl={feedUrl} />;
  } else if (second === "authors" && third) {
    page = <AuthorPage key={third} authorId={third} feedUrl={feedUrl} onFeedChange={refreshFeed} />;
  } else if (second && third === "edit") {
    if (signedIn) page = <PostEditor key={second} postId={second} feedUrl={feedUrl} />;
  } else if (second) {
    page = <PostPage key={second} postId={second} feedUrl={feedUrl} onFeedChange={refreshFeed} />;
  }
  const content = (
    <div ref={root}>
      {(isFeed || lastFeedSearch !== null) && (
        <div hidden={!isFeed}>
          <FeedPage key={feedRevision} search={isFeed ? search : lastFeedSearch ?? ""} active={isFeed} />
        </div>
      )}
      {page}
    </div>
  );
  return embedded ? content : <PublicShell>{content}</PublicShell>;
}
