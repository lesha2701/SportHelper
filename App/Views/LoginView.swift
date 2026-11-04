import SwiftUI

struct LoginView: View {
    @Environment(AuthStore.self) private var auth
    @State private var email = ""
    @State private var password = ""
    @State private var showPassword = false
    @FocusState private var focus: Field?
    private enum Field { case email, password }
    /// UI tests type into the fields; iOS's password autofill UI would interrupt that, so it is off while testing.
    private let uiTesting = ProcessInfo.processInfo.arguments.contains("-uiTesting")

    private var canSubmit: Bool { !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty && !auth.isWorking }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("ВХОД")
                    .font(.system(size: 44, weight: .heavy))
                    .accessibilityAddTraits(.isHeader)
                Text("Рады видеть вас снова. Войдите, чтобы продолжить.")
                    .foregroundStyle(.secondary)

                if let message = auth.errorMessage {
                    Label(message, systemImage: "exclamationmark.triangle")
                        .font(.callout)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                        .accessibilityIdentifier("login.error")
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Email").font(.subheadline.weight(.semibold))
                    TextField("name@example.com", text: $email)
                        .textContentType(uiTesting ? nil : .username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("login.email")
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Пароль").font(.subheadline.weight(.semibold))
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
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityLabel(showPassword ? "Скрыть пароль" : "Показать пароль")
                        .accessibilityIdentifier("login.togglePassword")
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
                }

                Button(action: submit) {
                    Group {
                        if auth.isWorking { ProgressView() } else { Text("Войти").fontWeight(.bold) }
                    }
                    .frame(maxWidth: .infinity, minHeight: 28)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.primary)
                .disabled(!canSubmit)
                .accessibilityIdentifier("login.submit")
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func submit() {
        guard canSubmit else { return }
        focus = nil
        Task { await auth.login(email: email, password: password) }
    }
}
