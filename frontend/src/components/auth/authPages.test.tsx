import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../../api/auth";
import { ApiError } from "../../api/client";
import type { User } from "../../types/user";
import { ClaimAccountPage } from "./ClaimAccountPage";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from "./TokenPages";

vi.mock("../../api/auth", () => ({
  login: vi.fn(),
  register: vi.fn(),
  resendVerification: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  verifyEmail: vi.fn(),
  inspectVerification: vi.fn(),
  verifyEmailWithNewPassword: vi.fn(),
  confirmEmailChange: vi.fn(),
  inspectClaim: vi.fn(),
  claimAccount: vi.fn(),
}));

const signIn = vi.fn();
let authState: Record<string, unknown> = { status: "guest", sessionExpired: false };
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ state: authState, signIn, refreshUser: vi.fn(), logout: vi.fn(), retry: vi.fn(), updateUser: vi.fn() }),
}));

const api = vi.mocked(authApi);
const STRONG = "correct horse battery";

const user = { id: "u1", firstName: "Алиса" } as User;

function at(path: string) {
  window.history.pushState(null, "", path);
}
const where = () => window.location.pathname + window.location.search;

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const apiError = (status: number, code: string, message: string, field: string | null = null, retryAfter: number | null = null) =>
  new ApiError(status, code, message, field, retryAfter);

beforeEach(() => {
  vi.clearAllMocks();
  authState = { status: "guest", sessionExpired: false };
  at("/");
});
afterEach(cleanup);

// --- registration ---------------------------------------------------------------------------

function fillRegistration(overrides: Partial<Record<"name" | "email" | "password" | "confirm", string>> = {}) {
  type("Имя", overrides.name ?? "Алиса");
  type("Email", overrides.email ?? "alice@example.com");
  type("Пароль", overrides.password ?? STRONG);
  type("Повторите пароль", overrides.confirm ?? overrides.password ?? STRONG);
}

describe("registration form", () => {
  it("explains every problem inline and sends nothing while the form is invalid", () => {
    render(<RegisterPage />);

    click("Зарегистрироваться");

    expect(screen.getByText("Укажите имя.")).toBeTruthy();
    expect(screen.getByText(/Введите email полностью/)).toBeTruthy();
    expect(screen.getByText(/Пароль слишком короткий: минимум 12/)).toBeTruthy();
    expect(screen.getByText(/Нужно принять пользовательское соглашение/)).toBeTruthy();
    expect(api.register).not.toHaveBeenCalled();
  });

  it("checks the confirmation and the 12-character minimum", () => {
    render(<RegisterPage />);
    fillRegistration({ password: "short pass", confirm: "short pass" });
    fireEvent.click(screen.getByRole("checkbox"));
    click("Зарегистрироваться");
    expect(screen.getByText(/слишком короткий/)).toBeTruthy();

    type("Пароль", STRONG);
    type("Повторите пароль", "something else entirely");
    click("Зарегистрироваться");
    expect(screen.getByText("Пароли не совпадают.")).toBeTruthy();
    expect(api.register).not.toHaveBeenCalled();
  });

  it("does not demand capitals, digits or symbols", () => {
    render(<RegisterPage />);
    fillRegistration({ password: "alllowercaseletters" });
    fireEvent.click(screen.getByRole("checkbox"));

    click("Зарегистрироваться");

    expect(api.register).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/заглавн|цифр|символ.*обязательн/i)).toBeNull();
  });

  it("sends the chosen role and consent, then tells the person to check their mail", async () => {
    api.register.mockResolvedValue({ email: "alice@example.com" });
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole("radio", { name: /Я тренер/ }));
    fillRegistration();
    fireEvent.click(screen.getByRole("checkbox"));

    click("Зарегистрироваться");

    await screen.findByText("Проверьте почту");
    expect(api.register).toHaveBeenCalledWith({
      firstName: "Алиса",
      lastName: "",
      email: "alice@example.com",
      password: STRONG,
      passwordConfirm: STRONG,
      acceptTerms: true,
      role: "coach",
      next: null,
    });
    expect(screen.getByText("alice@example.com")).toBeTruthy();
  });

  it("passes along where the person was heading, so the confirmation email can bring them back", async () => {
    api.register.mockResolvedValue({ email: "alice@example.com" });
    at("/register?next=%2F%3Fbook%3Dlisting-42");
    render(<RegisterPage />);
    fillRegistration();
    fireEvent.click(screen.getByRole("checkbox"));

    click("Зарегистрироваться");

    await screen.findByText("Проверьте почту");
    expect(api.register).toHaveBeenCalledWith(expect.objectContaining({ next: "/?book=listing-42" }));
    expect(screen.getByRole("link", { name: "Я подтвердил — войти" }).getAttribute("href")).toBe(
      "/login?email=alice%40example.com&next=%2F%3Fbook%3Dlisting-42",
    );
  });

  it("keeps what was typed when the server refuses, and offers sign-in for a taken email", async () => {
    api.register.mockRejectedValue(apiError(409, "email_taken", "Аккаунт с таким email уже есть.", "email"));
    render(<RegisterPage />);
    fillRegistration();
    fireEvent.click(screen.getByRole("checkbox"));

    click("Зарегистрироваться");

    await screen.findByText("Аккаунт с таким email уже есть.");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("alice@example.com");
    expect((screen.getByLabelText("Пароль") as HTMLInputElement).value).toBe(STRONG);
    expect(screen.getAllByRole("link", { name: "Войти" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "восстановить пароль" })).toBeTruthy();
  });

  it("lets a mistyped address be fixed from the check-your-mail screen without retyping everything", async () => {
    api.register.mockResolvedValue({ email: "alice@example.com" });
    render(<RegisterPage />);
    fillRegistration();
    fireEvent.click(screen.getByRole("checkbox"));
    click("Зарегистрироваться");
    await screen.findByText("Проверьте почту");

    click("Изменить адрес");

    expect((screen.getByLabelText("Имя") as HTMLInputElement).value).toBe("Алиса");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("alice@example.com");
  });

  it("a server-side message on a field is shown next to that field", async () => {
    api.register.mockRejectedValue(apiError(422, "password_common", "Этот пароль слишком распространён.", "password"));
    render(<RegisterPage />);
    fillRegistration();
    fireEvent.click(screen.getByRole("checkbox"));

    click("Зарегистрироваться");

    const message = await screen.findByText("Этот пароль слишком распространён.");
    expect(message.closest("div")?.querySelector("input")).toBe(screen.getByLabelText("Пароль"));
  });

  it("clears a field's message as soon as that field is edited", () => {
    render(<RegisterPage />);
    click("Зарегистрироваться");
    expect(screen.getByText("Укажите имя.")).toBeTruthy();

    type("Имя", "А");

    expect(screen.queryByText("Укажите имя.")).toBeNull();
  });

  it("can show and hide the password, and exposes autocomplete hints for password managers", () => {
    render(<RegisterPage />);
    const field = screen.getByLabelText("Пароль") as HTMLInputElement;
    expect(field.type).toBe("password");
    expect(field.autocomplete).toBe("new-password");
    expect((screen.getByLabelText("Email") as HTMLInputElement).autocomplete).toBe("username");

    fireEvent.click(screen.getAllByRole("button", { name: "Показать пароль" })[0]!);

    expect(field.type).toBe("text");
    expect(screen.getAllByRole("button", { name: "Скрыть пароль" })[0]!.getAttribute("aria-pressed")).toBe("true");
  });
});

// --- sign-in ----------------------------------------------------------------------------------

function fillLogin(email = "alice@example.com", password = STRONG) {
  type("Email", email);
  type("Пароль", password);
}

describe("login form", () => {
  it("signs in and continues to the page the person was heading for", async () => {
    api.login.mockResolvedValue({ user, csrfToken: "csrf" });
    at("/login?next=%2F%3Fbook%3Dlisting-42");
    render(<LoginPage />);
    fillLogin(" alice@example.com ");

    click("Войти");

    await waitFor(() => expect(signIn).toHaveBeenCalledWith({ user, csrfToken: "csrf" }));
    expect(api.login).toHaveBeenCalledWith("alice@example.com", STRONG);
    expect(where()).toBe("/?book=listing-42");
  });

  it("explains why the person is being asked to sign in when they were trying to book", () => {
    at("/login?next=%2F%3Fbook%3Dlisting-42");
    render(<LoginPage />);

    expect(screen.getByText(/чтобы записаться на тренировку/)).toBeTruthy();
  });

  it("ignores a crafted next= that points off-site", async () => {
    api.login.mockResolvedValue({ user, csrfToken: "csrf" });
    at("/login?next=https%3A%2F%2Fevil.example%2F");
    render(<LoginPage />);
    fillLogin();

    click("Войти");

    await waitFor(() => expect(signIn).toHaveBeenCalled());
    expect(where()).toBe("/");
  });

  it("shows a clear message for bad credentials and keeps the email", async () => {
    api.login.mockRejectedValue(apiError(401, "invalid_credentials", "Неверный email или пароль."));
    render(<LoginPage />);
    fillLogin();

    click("Войти");

    await screen.findByText("Неверный email или пароль.");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("alice@example.com");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("offers to resend the confirmation email to an unconfirmed account", async () => {
    api.login.mockRejectedValue(apiError(403, "email_not_verified", "Подтвердите email: мы отправили письмо."));
    api.resendVerification.mockResolvedValue("ok");
    render(<LoginPage />);
    fillLogin();
    click("Войти");

    fireEvent.click(await screen.findByRole("button", { name: "Отправить письмо ещё раз" }));

    await screen.findByText("Письмо отправлено — проверьте почту.");
    expect(api.resendVerification).toHaveBeenCalledWith("alice@example.com");
  });

  it("tells a locked-out person how long to wait", async () => {
    api.login.mockRejectedValue(apiError(429, "account_locked", "Слишком много неудачных попыток входа.", null, 840));
    render(<LoginPage />);
    fillLogin();

    click("Войти");

    await screen.findByText(/Повторить можно через 14 мин\./);
  });

  it("says so when the server cannot be reached", async () => {
    api.login.mockRejectedValue(apiError(0, "network_error", "Не удалось связаться с сервером"));
    render(<LoginPage />);
    fillLogin();

    click("Войти");

    await screen.findByText(/Нет связи с сервером/);
  });

  it("does not call the server for an obviously invalid email or an empty password", () => {
    render(<LoginPage />);
    type("Email", "nope");
    click("Войти");
    expect(screen.getByText(/Введите email полностью/)).toBeTruthy();

    type("Email", "alice@example.com");
    click("Войти");
    expect(screen.getByText("Введите пароль.")).toBeTruthy();
    expect(api.login).not.toHaveBeenCalled();
  });

  it("is never a dead end: links to recovery and sign-up", () => {
    render(<LoginPage />);

    expect(screen.getByRole("link", { name: "Забыли пароль?" }).getAttribute("href")).toBe("/forgot-password");
    expect(screen.getByRole("link", { name: "Создать аккаунт" }).getAttribute("href")).toBe("/register");
  });

  it("keeps the destination when going to sign-up instead", () => {
    at("/login?next=%2F%3Fbook%3D42");
    render(<LoginPage />);

    expect(screen.getByRole("link", { name: "Создать аккаунт" }).getAttribute("href")).toBe("/register?next=%2F%3Fbook%3D42");
  });

  it("greets a person whose session ran out, and one coming from a reset or confirmation", () => {
    authState = { status: "guest", sessionExpired: true };
    at("/login?reset=1&verified=1");
    render(<LoginPage />);

    expect(screen.getByText(/Сессия закончилась/)).toBeTruthy();
    expect(screen.getByText(/Пароль изменён/)).toBeTruthy();
    expect(screen.getByText(/Email подтверждён/)).toBeTruthy();
  });
});

// --- forgot / reset password ---------------------------------------------------------------------

describe("password recovery", () => {
  it("shows the server's neutral answer and a way back, whatever the address", async () => {
    api.forgotPassword.mockResolvedValue("Если аккаунт с таким адресом существует, мы отправили письмо.");
    render(<ForgotPasswordPage />);
    type("Email", "anyone@example.com");

    click("Прислать ссылку");

    await screen.findByText(/Если аккаунт с таким адресом существует, мы отправили письмо\./);
    expect(screen.getByRole("link", { name: "Вернуться ко входу" }).getAttribute("href")).toBe("/login");
  });

  it("validates the email before asking", () => {
    render(<ForgotPasswordPage />);
    type("Email", "nope");

    click("Прислать ссылку");

    expect(screen.getByText(/Введите email полностью/)).toBeTruthy();
    expect(api.forgotPassword).not.toHaveBeenCalled();
  });

  it("sets the new password and lands on the success page", async () => {
    api.resetPassword.mockResolvedValue(undefined);
    at("/reset-password?token=abc123");
    render(<ResetPasswordPage />);
    type("Новый пароль", STRONG);
    type("Повторите пароль", STRONG);

    click("Сохранить пароль");

    await waitFor(() => expect(where()).toBe("/password-changed"));
    expect(api.resetPassword).toHaveBeenCalledWith("abc123", STRONG, STRONG);
  });

  it("rejects mismatched or short passwords locally", () => {
    at("/reset-password?token=abc123");
    render(<ResetPasswordPage />);
    type("Новый пароль", "short");
    click("Сохранить пароль");
    expect(screen.getByText(/слишком короткий/)).toBeTruthy();

    type("Новый пароль", STRONG);
    type("Повторите пароль", "not the same one");
    click("Сохранить пароль");
    expect(screen.getByText("Пароли не совпадают.")).toBeTruthy();
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it("sends a person with a used or expired link straight to requesting a new one", async () => {
    api.resetPassword.mockRejectedValue(apiError(400, "invalid_token", "Ссылка недействительна или устарела."));
    at("/reset-password?token=old");
    render(<ResetPasswordPage />);
    type("Новый пароль", STRONG);
    type("Повторите пароль", STRONG);
    click("Сохранить пароль");

    const link = await screen.findByRole("link", { name: "Запросить новую ссылку" });

    expect(link.getAttribute("href")).toBe("/forgot-password");
  });

  it("explains a link without a code instead of showing an empty form", () => {
    at("/reset-password");
    render(<ResetPasswordPage />);

    expect(screen.getByRole("link", { name: "Запросить новую ссылку" })).toBeTruthy();
    expect(screen.queryByLabelText("Новый пароль")).toBeNull();
  });
});

// --- email confirmation ----------------------------------------------------------------------------

const VALID_LINK = { valid: true, email: "a***e@example.com", firstName: "Алиса" };

describe("email confirmation page", () => {
  beforeEach(() => api.inspectVerification.mockResolvedValue(VALID_LINK));

  it("asks for the registration password instead of confirming on a bare click", async () => {
    at("/verify-email?token=tok-ok");
    render(<VerifyEmailPage />);

    await screen.findByText("Подтвердите email");

    expect(screen.getByText("a***e@example.com")).toBeTruthy();
    expect(api.verifyEmail).not.toHaveBeenCalled(); // opening the link spends nothing
  });

  it("confirms with the password and offers to sign in", async () => {
    api.verifyEmail.mockResolvedValue({ email: "alice@example.com" });
    at("/verify-email?token=tok-ok");
    render(<VerifyEmailPage />);
    await screen.findByText("Подтвердите email");

    type("Пароль", STRONG);
    click("Подтвердить email");

    await screen.findByText("Email подтверждён");
    expect(api.verifyEmail).toHaveBeenCalledWith("tok-ok", STRONG);
    expect(screen.getByRole("link", { name: "Войти" }).getAttribute("href")).toBe("/login?verified=1");
  });

  it("a wrong password does not confirm, and points the real owner to setting a new one", async () => {
    api.verifyEmail.mockRejectedValue(apiError(403, "password_mismatch", "Пароль не совпадает с тем, что указан при регистрации.", "password"));
    api.verifyEmailWithNewPassword.mockResolvedValue({ email: "alice@example.com" });
    at("/verify-email?token=tok-hijack");
    render(<VerifyEmailPage />);
    await screen.findByText("Подтвердите email");
    type("Пароль", "a stranger chose this");
    click("Подтвердить email");

    await screen.findByText(/Пароль не совпадает/);
    fireEvent.click(screen.getByRole("button", { name: "задайте новый пароль" }));
    expect(await screen.findByRole("heading", { name: "Новый пароль" })).toBeTruthy();
    expect((screen.getByLabelText("Новый пароль") as HTMLInputElement).value).toBe(""); // the wrong guess isn't carried over
    type("Новый пароль", "my own brand new passphrase");
    type("Повторите пароль", "my own brand new passphrase");
    click("Подтвердить и сохранить пароль");

    await screen.findByText("Email подтверждён");
    expect(api.verifyEmailWithNewPassword).toHaveBeenCalledWith("tok-hijack", "my own brand new passphrase", "my own brand new passphrase");
  });

  it("someone who never registered can go straight to setting a new password", async () => {
    at("/verify-email?token=tok-x");
    render(<VerifyEmailPage />);
    await screen.findByText("Подтвердите email");

    fireEvent.click(screen.getByRole("button", { name: /Я не регистрировался/ }));

    expect(await screen.findByText(/Пароль, указанный при регистрации, перестанет действовать|перестанет действовать/)).toBeTruthy();
    type("Новый пароль", "short");
    click("Подтвердить и сохранить пароль");
    expect(screen.getByText(/слишком короткий/)).toBeTruthy();
    expect(api.verifyEmailWithNewPassword).not.toHaveBeenCalled();
  });

  it("after confirming, the sign-in link still leads to the booking the person started", async () => {
    api.verifyEmail.mockResolvedValue({ email: "alice@example.com" });
    at("/verify-email?token=tok-next&next=%2F%3Fbook%3Dlisting-42");
    render(<VerifyEmailPage />);
    await screen.findByText("Подтвердите email");
    type("Пароль", STRONG);
    click("Подтвердить email");

    await screen.findByText("Email подтверждён");

    expect(screen.getByRole("link", { name: "Войти" }).getAttribute("href")).toBe("/login?verified=1&next=%2F%3Fbook%3Dlisting-42");
  });

  it("ignores a hostile next in the link", async () => {
    api.verifyEmail.mockResolvedValue({ email: "alice@example.com" });
    at("/verify-email?token=tok-evil&next=https%3A%2F%2Fevil.example");
    render(<VerifyEmailPage />);
    await screen.findByText("Подтвердите email");
    type("Пароль", STRONG);
    click("Подтвердить email");

    await screen.findByText("Email подтверждён");

    expect(screen.getByRole("link", { name: "Войти" }).getAttribute("href")).toBe("/login?verified=1");
  });

  it("looking at the link twice (StrictMode) never spends it", async () => {
    at("/verify-email?token=tok-strict");

    render(
      <StrictMode>
        <VerifyEmailPage />
      </StrictMode>,
    );

    await screen.findByText("Подтвердите email");
    expect(api.verifyEmail).not.toHaveBeenCalled();
    expect(api.verifyEmailWithNewPassword).not.toHaveBeenCalled();
  });

  it("lets the person request a fresh link when this one is no longer valid", async () => {
    api.inspectVerification.mockResolvedValue({ valid: false, email: null, firstName: null });
    api.resendVerification.mockResolvedValue("ok");
    at("/verify-email?token=tok-bad");
    render(<VerifyEmailPage />);
    await screen.findByText("Ссылка не сработала");

    type(/Email, указанный при регистрации/, "alice@example.com");
    click("Прислать новую ссылку");

    await screen.findByText(/мы отправили новое письмо/);
    expect(api.resendVerification).toHaveBeenCalledWith("alice@example.com", null);
  });
});

// --- moving a Telegram-era account --------------------------------------------------------------------

describe("account transfer page (opened from the bot)", () => {
  it("tells a person with an expired link what to do", async () => {
    api.inspectClaim.mockResolvedValue({ valid: false, firstName: null });
    at("/claim?token=old");
    render(<ClaimAccountPage />);

    await screen.findByText("Ссылка устарела");

    expect(screen.getByText(/нажмите \/start/)).toBeTruthy();
  });

  it("greets the owner by name and collects an email and password", async () => {
    api.inspectClaim.mockResolvedValue({ valid: true, firstName: "Пётр" });
    api.claimAccount.mockResolvedValue({ email: "petr@example.com" });
    at("/claim?token=good");
    render(<ClaimAccountPage />);
    await screen.findByText(/Пётр, добро пожаловать/);

    type("Email", "petr@example.com");
    type("Пароль", STRONG);
    type("Повторите пароль", STRONG);
    fireEvent.click(screen.getByRole("checkbox"));
    click("Перенести аккаунт");

    await screen.findByText("Проверьте почту");
    expect(api.claimAccount).toHaveBeenCalledWith({
      token: "good",
      email: "petr@example.com",
      password: STRONG,
      passwordConfirm: STRONG,
      acceptTerms: true,
    });
  });

  it("requires consent before transferring", async () => {
    api.inspectClaim.mockResolvedValue({ valid: true, firstName: "Пётр" });
    at("/claim?token=good");
    render(<ClaimAccountPage />);
    await screen.findByText(/Пётр, добро пожаловать/);
    type("Email", "petr@example.com");
    type("Пароль", STRONG);
    type("Повторите пароль", STRONG);

    click("Перенести аккаунт");

    expect(screen.getByText(/Нужно принять пользовательское соглашение/)).toBeTruthy();
    expect(api.claimAccount).not.toHaveBeenCalled();
  });
});

describe("act() sanity", () => {
  it("renders without leaving pending updates", async () => {
    await act(async () => {
      render(<ForgotPasswordPage />);
    });
    expect(screen.getByText("Забыли пароль?")).toBeTruthy();
  });
});
