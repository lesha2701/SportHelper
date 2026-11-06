import Foundation

/// A place where the person is signed in (`SessionOut`): this phone, a browser, another phone.
public struct AccountSession: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    /// What the server made of the User-Agent: "Chrome на Windows", "Safari на iPhone"…
    public let device: String
    public let ipAddress: String?
    public let createdAt: Date
    public let lastSeenAt: Date
    public let current: Bool

    /// Newest activity first, with this device at the top.
    public static func ordered(_ sessions: [AccountSession]) -> [AccountSession] {
        sessions.sorted { lhs, rhs in
            if lhs.current != rhs.current { return lhs.current }
            return lhs.lastSeenAt > rhs.lastSeenAt
        }
    }
}

/// «Сменить пароль»: the old password is asked again, the new one twice. What is wrong is said by field, in the site's words.
public struct PasswordChangeDraft: Equatable, Sendable {
    public enum Field: Sendable { case current, new, confirm }

    public var current = ""
    public var new = ""
    public var confirm = ""

    public init(current: String = "", new: String = "", confirm: String = "") {
        self.current = current
        self.new = new
        self.confirm = confirm
    }

    public func fieldErrors() -> [Field: String] {
        var found: [Field: String] = [:]
        if current.isEmpty { found[.current] = "Введите текущий пароль." }
        if new.count < SignUpForm.minPasswordLength {
            found[.new] = "Пароль слишком короткий: минимум \(SignUpForm.minPasswordLength) символов."
        } else if new == current {
            found[.new] = "Новый пароль должен отличаться от текущего."
        }
        if new != confirm { found[.confirm] = "Пароли не совпадают." }
        return found
    }

    public var isReady: Bool { fieldErrors().isEmpty }

    /// The field a server error belongs to (`password`, `new_password`, `new_password_confirm`), when it names one.
    public static func field(forServer name: String?) -> Field? {
        switch name {
        case "password", "current_password": .current
        case "new_password": .new
        case "new_password_confirm": .confirm
        default: nil
        }
    }
}

/// «Изменить email»: the letter with the link goes to the new address, and the password says it is really the owner.
public struct EmailChangeDraft: Equatable, Sendable {
    public enum Field: Sendable { case email, password }

    public var newEmail = ""
    public var password = ""

    public init(newEmail: String = "", password: String = "") {
        self.newEmail = newEmail
        self.password = password
    }

    public var tidyEmail: String { newEmail.trimmingCharacters(in: .whitespacesAndNewlines) }

    public func fieldErrors(currentEmail: String? = nil) -> [Field: String] {
        var found: [Field: String] = [:]
        if !SignUpForm.looksLikeEmail(newEmail) {
            found[.email] = "Введите email полностью, например name@example.com."
        } else if let currentEmail, tidyEmail.lowercased() == currentEmail.lowercased() {
            found[.email] = "Это уже ваш текущий адрес."
        }
        if password.isEmpty { found[.password] = "Введите пароль для подтверждения." }
        return found
    }

    public func isReady(currentEmail: String?) -> Bool { fieldErrors(currentEmail: currentEmail).isEmpty }

    public static func field(forServer name: String?) -> Field? {
        switch name {
        case "new_email": .email
        case "password": .password
        default: nil
        }
    }
}

struct PasswordChangeBody: Encodable, Sendable {
    let currentPassword: String
    let newPassword: String
    let newPasswordConfirm: String
}

struct EmailChangeBody: Encodable, Sendable {
    let newEmail: String
    let password: String
}

/// The person's own privacy choices (`PrivacySettingsOut`). There is one: whether a personal coach may use their data for an AI analysis.
public struct PrivacySettings: Decodable, Equatable, Sendable {
    public let allowAiAnalysisByPersonalCoach: Bool

    public init(allowAiAnalysisByPersonalCoach: Bool) { self.allowAiAnalysisByPersonalCoach = allowAiAnalysisByPersonalCoach }
}

struct PrivacySettingsBody: Encodable, Sendable {
    let allowAiAnalysisByPersonalCoach: Bool
}
