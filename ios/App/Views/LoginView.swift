import SwiftUI

struct LoginView: View {
    @Environment(AuthStore.self) private var auth
    @State private var email = ""
    @State private var password = ""
    @State private var showPassword = false
    @State private var signingUp = false
    @State private var forgotOpen = false
    @State private var confirmingEmail = false
    @FocusState private var focus: Field?
    private enum Field { case email, password }
    /// UI tests type into the fields; iOS's password autofill UI would interrupt that, so it is off while testing.
    private let uiTesting = ProcessInfo.processInfo.arguments.contains("-uiTesting")

    private var canSubmit: Bool { !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty && !auth.isWorking }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                brandBar
                form
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
        .ignoresSafeArea(edges: .top)
        .fullScreenCover(isPresented: $signingUp) {
            RegisterView { address in
                email = address
                password = ""
            }
        }
        .sheet(isPresented: $forgotOpen) { ForgotPasswordView(email: email) }
        .sheet(isPresented: $confirmingEmail) {
            CheckEmailView(email: email.trimmingCharacters(in: .whitespaces), onChangeEmail: nil) { confirmingEmail = false }
                .presentationDetents([.large])
        }
    }

    /// The slim graphite bar of the site's sign-in screen: the emblem, the name, the wave stripes.
    private var brandBar: some View {
        ZStack(alignment: .bottomLeading) {
            Color(red: 0x17 / 255, green: 0x18 / 255, blue: 0x1b / 255)
            Ornament(bold: true)
                .frame(width: 260, height: 90)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                .offset(x: 30, y: 24)
                .clipped()
            HStack(spacing: 12) {
                BrandLogo(size: 52)
                Text("SportArenaGlobal")
                    .font(Theme.display(19, relativeTo: .headline)).tracking(0.8).textCase(.uppercase)
                    .foregroundStyle(Color(red: 0.95, green: 0.945, blue: 0.937))
                Spacer()
                ThemeToggleButton(onDark: true)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 18)
        }
        .frame(height: 150)
        .clipped()
        .accessibilityElement(children: .contain)
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Вход")
                .font(Theme.display(34, weight: .heavy, relativeTo: .largeTitle)).tracking(0.3).textCase(.uppercase)
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
            Text("Рады видеть вас снова. Войдите, чтобы продолжить.")
                .font(Theme.body(15)).foregroundStyle(Theme.textSecondary)

            if let message = auth.errorMessage {
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.danger)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.dangerTint, in: RoundedRectangle(cornerRadius: Theme.radius))
                    .accessibilityIdentifier("login.error")
            }

            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("Email")
                TextField("name@example.com", text: $email)
                    .textContentType(uiTesting ? nil : .username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focus, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { focus = .password }
                    .fieldBox()
                    .accessibilityIdentifier("login.email")
            }
            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("Пароль")
                HStack(spacing: 8) {
                    Group {
                        if showPassword {
                            TextField("Пароль", text: $password)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                        } else {
                            SecureField("Пароль", text: $password)
                        }
                    }
                    .textContentType(uiTesting ? nil : .password)
                    .focused($focus, equals: .password)
                    .submitLabel(.go)
                    .onSubmit(submit)
                    .accessibilityIdentifier("login.password")

                    Button {
                        showPassword.toggle()
                    } label: {
                        Image(systemName: showPassword ? "eye.slash" : "eye")
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .accessibilityLabel(showPassword ? "Скрыть пароль" : "Показать пароль")
                    .accessibilityIdentifier("login.togglePassword")
                }
                .fieldBox()
            }

            Button(action: submit) {
                Group {
                    if auth.isWorking { ProgressView().tint(.white) } else { Text("Войти") }
                }
            }
            .buttonStyle(.sag)
            .disabled(!canSubmit)
            .padding(.top, 4)
            .accessibilityIdentifier("login.submit")

            if auth.errorCode == "email_not_verified" {
                Button("Отправить письмо с подтверждением ещё раз") { confirmingEmail = true }
                    .font(Theme.body(14, weight: .semibold)).foregroundStyle(Theme.primary)
                    .accessibilityIdentifier("login.confirmEmail")
            }

            HStack {
                Button("Забыли пароль?") { forgotOpen = true }.accessibilityIdentifier("login.forgot")
                Spacer()
                Button("Создать аккаунт") { signingUp = true }.accessibilityIdentifier("login.register")
            }
            .font(Theme.body(15, weight: .semibold)).foregroundStyle(Theme.primary)
            .padding(.top, 2)

            Text("Платформа для игроков и тренеров: расписание, записи на занятия, задания и статистика — в одном месте.")
                .font(Theme.body(13)).foregroundStyle(Theme.textTertiary)
                .padding(.top, 8)
        }
        .padding(24)
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text).font(Theme.body(13, weight: .semibold, relativeTo: .subheadline)).foregroundStyle(Theme.text)
    }

    private func submit() {
        guard canSubmit else { return }
        focus = nil
        Task { await auth.login(email: email, password: password) }
    }
}
