import { apiRequest, apiUpload } from "./client";

export type PostStatus = "draft" | "pending" | "published" | "rejected" | "removed";
export type FeedSort = "new" | "popular";
export type BlockType = "paragraph" | "heading" | "quote" | "list";

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: "Черновик",
  pending: "На проверке",
  published: "Опубликована",
  rejected: "Отклонена",
  removed: "Снята",
};

/** At most three photos in one article. */
export const MAX_POST_IMAGES = 3;
export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const BODY_MIN = 30;
export const BODY_MAX = 10000;

export interface PostBlock {
  type: BlockType;
  /** paragraph / heading / quote: the text, with **bold** and *italic* markers. */
  text?: string | null;
  /** list: one string per item. */
  items?: string[] | null;
}

export interface PostAuthor {
  id: string;
  name: string;
  isCoach: boolean;
  isPro: boolean;
  /** A trainer's profile is always open; a player's only if they allowed it. */
  profileOpen: boolean;
  avatarFileId: string | null;
}

export interface PostListing {
  id: string;
  title: string;
  pricePerSession: number | null;
  currency: string;
  photoFileId: string | null;
  coachUserId: string;
}

export interface PostCard {
  id: string;
  title: string;
  sport: string;
  excerpt: string;
  coverFileId: string | null;
  imagesCount: number;
  author: PostAuthor;
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  publishedAt: string | null;
  likedByMe: boolean;
}

export interface Post extends PostCard {
  status: PostStatus;
  blocks: PostBlock[];
  imageIds: string[];
  listing: PostListing | null;
  bookmarkedByMe: boolean;
  isMine: boolean;
  rejectReason: string | null;
  flags: string[];
  updatedAt: string;
  sentForReview: boolean;
}

export interface MyPost {
  id: string;
  title: string;
  sport: string;
  status: PostStatus;
  rejectReason: string | null;
  publishedAt: string | null;
  updatedAt: string;
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  coverFileId: string | null;
}

export interface PostComment {
  id: string;
  postId: string;
  author: PostAuthor;
  body: string;
  contactHidden: boolean;
  createdAt: string;
  isMine: boolean;
}

export interface AuthorProfile extends PostAuthor {
  sport: string | null;
  specialization: string | null;
  experienceYears: number | null;
  postsCount: number;
  mutedByMe: boolean;
}

export interface PostInput {
  title: string;
  sport: string;
  blocks: PostBlock[];
  imageIds: string[];
  listingId: string | null;
  submit: boolean;
}

interface AuthorDto {
  id: string;
  name: string;
  is_coach: boolean;
  is_pro: boolean;
  profile_open: boolean;
  avatar_file_id: string | null;
}

interface CardDto {
  id: string;
  title: string;
  sport: string;
  excerpt: string;
  cover_file_id: string | null;
  images_count: number;
  author: AuthorDto;
  likes_count: number;
  comments_count: number;
  views_count: number;
  published_at: string | null;
  liked_by_me: boolean;
}

interface PostDto extends CardDto {
  status: PostStatus;
  blocks: PostBlock[];
  image_ids: string[];
  listing: { id: string; title: string; price_per_session: number | null; currency: string; photo_file_id: string | null; coach_user_id: string } | null;
  bookmarked_by_me: boolean;
  is_mine: boolean;
  reject_reason: string | null;
  flags: string[];
  updated_at: string;
  sent_for_review: boolean;
}

export const mapAuthor = (d: AuthorDto): PostAuthor => ({
  id: d.id,
  name: d.name,
  isCoach: d.is_coach,
  isPro: d.is_pro,
  profileOpen: d.profile_open,
  avatarFileId: d.avatar_file_id,
});

export const mapCard = (d: CardDto): PostCard => ({
  id: d.id,
  title: d.title,
  sport: d.sport,
  excerpt: d.excerpt,
  coverFileId: d.cover_file_id,
  imagesCount: d.images_count,
  author: mapAuthor(d.author),
  likesCount: d.likes_count,
  commentsCount: d.comments_count,
  viewsCount: d.views_count,
  publishedAt: d.published_at,
  likedByMe: d.liked_by_me,
});

const mapPost = (d: PostDto): Post => ({
  ...mapCard(d),
  status: d.status,
  blocks: d.blocks,
  imageIds: d.image_ids,
  listing: d.listing
    ? {
        id: d.listing.id,
        title: d.listing.title,
        pricePerSession: d.listing.price_per_session,
        currency: d.listing.currency,
        photoFileId: d.listing.photo_file_id,
        coachUserId: d.listing.coach_user_id,
      }
    : null,
  bookmarkedByMe: d.bookmarked_by_me,
  isMine: d.is_mine,
  rejectReason: d.reject_reason,
  flags: d.flags,
  updatedAt: d.updated_at,
  sentForReview: d.sent_for_review,
});

export interface PostPage {
  total: number;
  items: PostCard[];
}

interface PageDto {
  total: number;
  items: CardDto[];
}

const query = (params: Record<string, string | number | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export async function listPosts(params: { sport?: string | null; sort?: FeedSort; authorId?: string | null; limit?: number; offset?: number }): Promise<PostPage> {
  const dto = await apiRequest<PageDto>(
    `/api/blog/posts${query({ sport: params.sport, sort: params.sort, author_id: params.authorId, limit: params.limit, offset: params.offset })}`,
    { silent: true },
  );
  return { total: dto.total, items: dto.items.map(mapCard) };
}

export async function listSavedPosts(offset = 0): Promise<PostPage> {
  const dto = await apiRequest<PageDto>(`/api/blog/bookmarks${query({ offset })}`, { silent: true });
  return { total: dto.total, items: dto.items.map(mapCard) };
}

export async function featuredPost(): Promise<PostCard | null> {
  const dto = await apiRequest<CardDto | null>("/api/blog/featured", { silent: true });
  return dto ? mapCard(dto) : null;
}

export async function listMyPosts(): Promise<MyPost[]> {
  const dtos = await apiRequest<
    {
      id: string;
      title: string;
      sport: string;
      status: PostStatus;
      reject_reason: string | null;
      published_at: string | null;
      updated_at: string;
      likes_count: number;
      comments_count: number;
      views_count: number;
      cover_file_id: string | null;
    }[]
  >("/api/blog/mine", { silent: true });
  return dtos.map((d) => ({
    id: d.id,
    title: d.title,
    sport: d.sport,
    status: d.status,
    rejectReason: d.reject_reason,
    publishedAt: d.published_at,
    updatedAt: d.updated_at,
    likesCount: d.likes_count,
    commentsCount: d.comments_count,
    viewsCount: d.views_count,
    coverFileId: d.cover_file_id,
  }));
}

export async function getPost(id: string): Promise<Post> {
  return mapPost(await apiRequest<PostDto>(`/api/blog/posts/${id}`, { silent: true }));
}

const body = (input: PostInput) => ({
  title: input.title,
  sport: input.sport,
  blocks: input.blocks.map((b) => (b.type === "list" ? { type: b.type, items: b.items ?? [] } : { type: b.type, text: b.text ?? "" })),
  image_ids: input.imageIds,
  listing_id: input.listingId,
  submit: input.submit,
});

/** The editor shows the server's reasons itself (what the check refused), so the generic error toast is off. */
export async function createPost(input: PostInput): Promise<Post> {
  return mapPost(await apiRequest<PostDto>("/api/blog/posts", { method: "POST", body: body(input), silent: true }));
}

export async function updatePost(id: string, input: PostInput): Promise<Post> {
  return mapPost(await apiRequest<PostDto>(`/api/blog/posts/${id}`, { method: "PUT", body: body(input), silent: true }));
}

export async function deletePost(id: string): Promise<void> {
  await apiRequest<void>(`/api/blog/posts/${id}`, { method: "DELETE", successMessage: "Статья удалена" });
}

export async function uploadPostImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const dto = await apiUpload<{ file_id: string }>("/api/blog/images", { formData });
  return dto.file_id;
}

export async function setLike(id: string, liked: boolean): Promise<{ liked: boolean; likesCount: number }> {
  const dto = await apiRequest<{ liked: boolean; likes_count: number }>(`/api/blog/posts/${id}/like`, { method: liked ? "PUT" : "DELETE", silent: true });
  return { liked: dto.liked, likesCount: dto.likes_count };
}

export const setBookmark = (id: string, saved: boolean) =>
  apiRequest<void>(`/api/blog/posts/${id}/bookmark`, { method: saved ? "PUT" : "DELETE", successMessage: saved ? "Сохранено" : "Убрано из сохранённых" });

export const setPostHidden = (id: string, hidden: boolean) =>
  apiRequest<void>(`/api/blog/posts/${id}/hide`, { method: hidden ? "PUT" : "DELETE", successMessage: hidden ? "Статья скрыта" : undefined });

export const setAuthorMuted = (authorId: string, muted: boolean) =>
  apiRequest<void>(`/api/blog/authors/${authorId}/mute`, { method: muted ? "PUT" : "DELETE", successMessage: muted ? "Автор скрыт" : "Автор снова виден" });

/** Counted on the server once per signed-in person per day; a failure is not worth a message. */
export const countView = (id: string) => apiRequest<void>(`/api/blog/posts/${id}/view`, { method: "POST", silent: true });

export async function listComments(id: string): Promise<PostComment[]> {
  const dtos = await apiRequest<
    { id: string; post_id: string; author: AuthorDto; body: string; contact_hidden: boolean; created_at: string; is_mine: boolean }[]
  >(`/api/blog/posts/${id}/comments`, { silent: true });
  return dtos.map((d) => ({
    id: d.id,
    postId: d.post_id,
    author: mapAuthor(d.author),
    body: d.body,
    contactHidden: d.contact_hidden,
    createdAt: d.created_at,
    isMine: d.is_mine,
  }));
}

export async function addComment(id: string, text: string): Promise<PostComment> {
  const d = await apiRequest<{ id: string; post_id: string; author: AuthorDto; body: string; contact_hidden: boolean; created_at: string; is_mine: boolean }>(
    `/api/blog/posts/${id}/comments`,
    { method: "POST", body: { body: text } },
  );
  return { id: d.id, postId: d.post_id, author: mapAuthor(d.author), body: d.body, contactHidden: d.contact_hidden, createdAt: d.created_at, isMine: d.is_mine };
}

export const deleteComment = (commentId: string) => apiRequest<void>(`/api/blog/comments/${commentId}`, { method: "DELETE", successMessage: "Комментарий удалён" });

export async function getAuthor(id: string): Promise<AuthorProfile> {
  const d = await apiRequest<
    AuthorDto & { sport: string | null; specialization: string | null; experience_years: number | null; posts_count: number; muted_by_me: boolean }
  >(`/api/blog/authors/${id}`, { silent: true });
  return {
    ...mapAuthor(d),
    sport: d.sport,
    specialization: d.specialization,
    experienceYears: d.experience_years,
    postsCount: d.posts_count,
    mutedByMe: d.muted_by_me,
  };
}

export async function getBlogSettings(): Promise<{ showProfileInPosts: boolean; isCoach: boolean }> {
  const d = await apiRequest<{ show_profile_in_posts: boolean; is_coach: boolean }>("/api/blog/settings", { silent: true });
  return { showProfileInPosts: d.show_profile_in_posts, isCoach: d.is_coach };
}

export async function saveBlogSettings(showProfileInPosts: boolean): Promise<void> {
  await apiRequest("/api/blog/settings", { method: "PUT", body: { show_profile_in_posts: showProfileInPosts }, successMessage: "Сохранено" });
}
