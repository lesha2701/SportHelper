import SportArenaKit
import SwiftUI

// MARK: - Check your mail

/// «Проверьте почту»: where the person lands after signing up or when the sign-in says the address is not confirmed. Never a dead end:
/// send the letter again (not more often than once a minute), fix a mistyped address, or sign in.
struct CheckEmailView: View {
    @Environment(AuthStore.self) private var auth
    let email: String
    var onChangeEmail: (() -> Void)?
    var onSignIn: () -> Void

    @State private var sending = false
    @State private var sent = false
    @State private var error: String?
    @State private var cooldown = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Image(systemName: "envelope.badge")
                    .font(.system(size: 34)).foregroundStyle(Theme.primary)
                    .frame(width: 68, height: 68)
                    .background(Theme.primaryTint, in: RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous))
                    .accessibilityHidden(true)
                Text("Проверьте почту")
                    .font(Theme.display(32, weight: .heavy, relativeTo: .largeTitle)).textCase(.uppercase).foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)
                Text("Мы отправили письмо со ссылкой на \(email). Откройте его, нажмите «Подтвердить email» и введите пароль. "
                     + "Ссылка действует 24 часа. Потом вернитесь сюда и войдите.")
                    .font(Theme.body(15)).foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("checkEmail.text")
                if sent && cooldown > 0 { AuthNotice(kind: .success, text: "Письмо отправлено ещё раз. Проверьте и папку «Спам».") }
                if let error { AuthNotice(kind: .danger, text: error) }

                Button { Task { await resend() } } label: {
                    Text(cooldown > 0 ? "Отправить ещё раз (\(cooldown))" : (sending ? "Отправляем…" : "Отправить письмо ещё раз"))
                }
                .buttonStyle(.sagGhost)
                .disabled(sending || cooldown > 0)
                .accessibilityIdentifier("checkEmail.resend")

                Button("Я подтвердил — войти", action: onSignIn)
                    .buttonStyle(.sag)
                    .accessibilityIdentifier("checkEmail.signIn")

                if let onChangeEmail {
                    Button("Письмо не приходит? Изменить адрес", action: onChangeEmail)
                        .font(Theme.body(14, weight: .semibold)).foregroundStyle(Theme.primary)
                        .accessibilityIdentifier("checkEmail.change")
                }
            }
            .padding(24)
        }
    }

    private func resend() async {
        sending = true
        error = nil
        defer { sending = false }
        do {
            _ = try await auth.resendVerification(email: email)
            sent = true
            await countDown(from: 60)
        } catch let failure as APIError {
            error = failure.message
            if let wait = failure.retryAfter { await countDown(from: wait) }
        } catch {
            self.error = APIError.unknown.message
        }
    }

    private func countDown(from seconds: Int) async {
        cooldown = seconds
        while cooldown > 0 {
            try? await Task.sleep(for: .seconds(1))
            if Task.isCancelled { return }
            cooldown -= 1
        }
    }
}

// MARK: - Forgotten password

/// «Забыли пароль»: the address, and the server sends a letter whose link opens the site to choose a new one.
struct ForgotPasswordView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State var email: String
    @State private var working = false
    @State private var answer: String?
    @State private var error: String?

    init(email: String = "") { _email = State(initialValue: email) }

    private var canSend: Bool { SignUpForm.looksLikeEmail(email) && !working }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Забыли пароль?")
                        .font(Theme.display(32, weight: .heavy, relativeTo: .largeTitle)).textCase(.uppercase).foregroundStyle(Theme.text)
                        .accessibilityAddTraits(.isHeader)
                    Text("Введите email, с которым вы регистрировались. Мы пришлём письмо со ссылкой для нового пароля.")
                        .font(Theme.body(15)).foregroundStyle(Theme.textSecondary)
                    if let answer { AuthNotice(kind: .success, text: answer).accessibilityIdentifier("forgot.answer") }
                    if let error { AuthNotice(kind: .danger, text: error).accessibilityIdentifier("forgot.error") }
                    AuthField(label: "Email", required: true) {
                        TextField("name@example.com", text: $email)
                            .keyboardType(.emailAddress).textContentType(.username)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .accessibilityIdentifier("forgot.email")
                    }
                    Button(action: send) {
                        if working { ProgressView().tint(.white) } else { Text(answer == nil ? "Отправить письмо" : "Отправить ещё раз") }
                    }
                    .buttonStyle(.sag)
                    .disabled(!canSend)
                    .accessibilityIdentifier("forgot.send")
                }
                .padding(24)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.bg.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { dismiss() }.accessibilityIdentifier("forgot.close") }
            }
        }
    }

    private func send() {
        working = true
        error = nil
        Task {
            defer { working = false }
            do {
                answer = try await auth.forgotPassword(email: email)
            } catch let failure as APIError {
                error = failure.message
            } catch {
                self.error = APIError.unknown.message
            }
        }
    }
}
