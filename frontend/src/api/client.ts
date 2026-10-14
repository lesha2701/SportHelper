import { toast } from "../toast";

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** The form field a validation message belongs to, when the server says so. */
  readonly field: string | null;
  /** Seconds to wait before retrying a rate-limited/locked request. */
  readonly retryAfter: number | null;

  constructor(status: number, code: string, message: string, field: string | null = null, retryAfter: number | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
    this.retryAfter = retryAfter;
  }
}

interface ApiErrorBody {
  error: { code: string; message: string; field?: string; retry_after?: number };
}

// --- session plumbing -------------------------------------------------------
//
// The session itself is an HttpOnly cookie the page can't read; the browser
// sends it with `credentials: "include"`. The only thing JavaScript holds is
// the CSRF token the server hands out with /api/auth/me, kept in memory (never
// in localStorage/sessionStorage) and echoed on every state-changing request.

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/** Called when a request that carried a session is answered with 401 — the
 * session expired or was ended elsewhere — so the app can fall back to the
 * signed-out state instead of leaving a dead screen. */
export function onSessionExpired(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

/** Pairs of a path prefix that may legitimately answer 401 without meaning "your session ended". */
const AUTH_FORM_PATHS = ["/api/auth/login", "/api/auth/register", "/api/auth/me"];

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }
  const err = (value as { error: unknown }).error;
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "message" in err
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (isApiErrorBody(data)) {
      const { code, message, field, retry_after } = data.error;
      throw new ApiError(response.status, code, message, field ?? null, retry_after ?? null);
    }
    throw new ApiError(response.status, "unknown_error", "Неизвестная ошибка сервера");
  }

  return data as T;
}

interface ToastOptions {
  /** Toast shown when a change (anything but GET) succeeds. */
  successMessage?: string;
  /** No toast at all, neither success nor the automatic error one. */
  silent?: boolean;
}

interface RequestOptions extends ToastOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Ignored: kept so the many `apiRequest(path, { token })` call sites keep
   * compiling. Authentication is the session cookie, not a token argument. */
  token?: string | null;
}

/** Every failed change (POST/PUT/PATCH/DELETE/upload) tells the user why,
 * so a click never ends in silence; successes toast only when the caller
 * gave a message. */
async function withToasts<T>(run: () => Promise<T>, options: ToastOptions, isChange: boolean): Promise<T> {
  try {
    const result = await run();
    if (isChange && !options.silent && options.successMessage) toast.success(options.successMessage);
    return result;
  } catch (error) {
    // 401 is handled by the auth flow (re-login), not something to shout about.
    if (isChange && !options.silent && !(error instanceof ApiError && error.status === 401)) {
      toast.error(error instanceof ApiError ? error.message : "Не удалось выполнить действие");
    }
    throw error;
  }
}

export function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return withToasts(() => doRequest<T>(path, options), options, (options.method ?? "GET") !== "GET");
}

function authHeaders(method: string): Record<string, string> {
  return method !== "GET" && csrfToken ? { "X-CSRF-Token": csrfToken } : {};
}

function notifyIfSessionEnded(path: string, status: number): void {
  if (status === 401 && !AUTH_FORM_PATHS.some((prefix) => path.startsWith(prefix))) {
    unauthorizedListeners.forEach((listener) => listener());
  }
}

async function doRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { ...authHeaders(method) };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network_error", "Не удалось связаться с сервером");
  }

  notifyIfSessionEnded(path, response.status);
  return parseResponse<T>(response);
}

/** Like apiRequest, but sends a FormData body (multipart/form-data) instead
 * of JSON — for file uploads. The browser sets the Content-Type boundary
 * header itself, so it must not be set manually here. */
export function apiUpload<T>(
  path: string,
  options: ToastOptions & { token?: string; formData: FormData; method?: "POST" | "PUT" },
): Promise<T> {
  return withToasts(() => doUpload<T>(path, options), options, true);
}

async function doUpload<T>(
  path: string,
  options: { formData: FormData; method?: "POST" | "PUT" },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "POST",
      headers: authHeaders(options.method ?? "POST"),
      credentials: "include",
      body: options.formData,
    });
  } catch {
    throw new ApiError(0, "network_error", "Не удалось связаться с сервером");
  }

  notifyIfSessionEnded(path, response.status);
  return parseResponse<T>(response);
}
