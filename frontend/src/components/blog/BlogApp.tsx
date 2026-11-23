import { useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { loginUrl, navigate } from "../../router";
import { PublicShell } from "../public/PublicShell";
import { AuthorPage } from "./AuthorPage";
import { FeedPage } from "./FeedPage";
import { PostEditor } from "./PostEditor";
import { PostPage } from "./PostPage";

/** The blog's pages, open to guests and signed-in people alike: the feed, one article, an author, and (signed-in only) the editor. */
export function BlogApp({ path }: { path: string }) {
  const { state } = useAuth();
  const signedIn = state.status === "ready";
  const parts = path.split("/").filter(Boolean); // ["blog", ...]
  const second = parts[1] ?? "";
  const third = parts[2] ?? "";
  const needsLogin = second === "new" || third === "edit";

  useEffect(() => {
    if (needsLogin && !signedIn) navigate(loginUrl(path), { replace: true });
  }, [needsLogin, signedIn, path]);

  let page;
  if (parts.length === 1) page = <FeedPage />;
  else if (second === "new") page = signedIn ? <PostEditor key="new" postId={null} /> : null;
  else if (second === "authors" && third) page = <AuthorPage key={third} authorId={third} />;
  else if (third === "edit") page = signedIn ? <PostEditor key={second} postId={second} /> : null;
  else page = <PostPage key={second} postId={second} />;

  return <PublicShell>{page}</PublicShell>;
}
