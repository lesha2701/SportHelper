import { API_BASE_URL } from "@/config";
import { getToken } from "./tokenStore";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field: string | null;
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

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const err = (value as { error: unknown }).error;
  return typeof err === "object" && err !== null && "code" in err && "message" in err;
}

/** Turns a response into data, or into an ApiError built from the server's {error:{code,message}} body. */
export async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    if (isApiErrorBody(data)) {
      const { code, message, field, retry_after } = data.error;
      throw new ApiError(response.status, code, message, field ?? null, retry_after ?? null);
    }
    if (response.status === 422) {
      // FastAPI's own validation answer ({"detail": [...]}) for a body the app should have kept within limits.
      throw new ApiError(422, "validation_error", "Проверьте введённые данные: одно из значений вне допустимых пределов.");
    }
    throw new ApiError(response.status, "unknown_error", "Неизвестная ошибка сервера");
  }
  return data as T;
}

type Listener = () => void;
const sessionEndedListeners = new Set<Listener>();

/** Called when a signed-in request is answered with 401: the session expired or was ended elsewhere. */
export function onSessionExpired(listener: Listener): () => void {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

/** Paths where a 401 means "wrong credentials" or "not signed in yet", not "your session ended". */
const AUTH_FORM_PATHS = ["/api/auth/mobile/login", "/api/auth/register", "/api/auth/me"];

type NoticeListener = (message: string) => void;
const successListeners = new Set<NoticeListener>();

/** Called with the `successMessage` of every change that succeeded (the toast host shows it). */
export function onSuccessMessage(listener: NoticeListener): () => void {
  successListeners.add(listener);
  return () => {
    successListeners.delete(listener);
  };
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Shown as a toast when a change succeeds. */
  successMessage?: string;
  /** Accepted for parity with the website's API layer; screens show their own errors. */
  silent?: boolean;
}

/** A file picked on the phone (camera, gallery): React Native uploads it by uri. */
export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, "network_error", "Не удалось связаться с сервером");
  }

  if (response.status === 401 && token && !AUTH_FORM_PATHS.some((prefix) => path.startsWith(prefix))) {
    sessionEndedListeners.forEach((listener) => listener());
  }
  const result = await parseResponse<T>(response);
  if (options.successMessage) successListeners.forEach((listener) => listener(options.successMessage!));
  return result;
}

/** multipart/form-data upload (photos, videos). The Content-Type boundary is set by fetch itself. */
export async function apiUpload<T>(
  path: string,
  options: { formData: FormData; method?: "POST" | "PUT"; successMessage?: string; silent?: boolean },
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { method: options.method ?? "POST", headers, body: options.formData });
  } catch {
    throw new ApiError(0, "network_error", "Не удалось связаться с сервером");
  }
  if (response.status === 401 && token) sessionEndedListeners.forEach((listener) => listener());
  const result = await parseResponse<T>(response);
  if (options.successMessage) successListeners.forEach((listener) => listener(options.successMessage!));
  return result;
}
