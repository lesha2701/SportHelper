import Foundation

/// The legal documents of the site. Their texts are published by the site at `path`, and the app carries a copy to read in place
/// (`LegalText`, `App/Resources/Legal`); the edition below is what
/// the sign-up form reports as «accepted», and the server records an acceptance only when the edition is its current one.
/// The same list lives in `frontend/src/legal/documents.ts` and `backend/app/services/legal.py`: change all three together.
public enum LegalDocument: String, CaseIterable, Identifiable, Sendable {
    case terms
    case coachOffer = "coach-offer"
    case serviceTerms = "service-terms"
    case privacy
    case consentPlayer = "consent-player"
    case consentCoach = "consent-coach"
    case consentCoachDissemination = "consent-coach-dissemination"

    public var id: String { rawValue }
    /// The key the server knows the document by.
    public var key: String { rawValue }
    /// Where the site publishes it (after the site's address).
    public var path: String { "/" + rawValue }
    /// The edition, YYYY-MM-DD.
    public var version: String { "2026-10-20" }

    public var title: String {
        switch self {
        case .terms: "Пользовательское соглашение"
        case .coachOffer: "Оферта для тренеров"
        case .serviceTerms: "Типовые условия оказания услуг тренером"
        case .privacy: "Политика обработки персональных данных"
        case .consentPlayer: "Согласие спортсмена на обработку ПДн"
        case .consentCoach: "Согласие тренера на обработку ПДн"
        case .consentCoachDissemination: "Согласие тренера на распространение ПДн"
        }
    }
}

/// One check box of the sign-up form: what is accepted and the documents it covers. None is ticked in advance, each is ticked on its own.
public struct ConsentBox: Equatable, Identifiable, Sendable {
    public let key: String
    public let documents: [LegalDocument]
    public var id: String { key }

    /// The sentence before the list of documents.
    public var lead: String {
        switch key {
        case "personal_data": "Даю согласие на обработку моих персональных данных на условиях:"
        case "data_dissemination": "Даю согласие на распространение моих персональных данных, перечисленных в разделе 5, в публичном профиле:"
        default: "Принимаю условия:"
        }
    }

    /// What the server is told when the box is ticked: every document with its edition.
    var acceptance: ConsentAcceptance {
        ConsentAcceptance(key: key, documents: documents.map { .init(key: $0.key, version: $0.version) })
    }
}

public extension UserRole {
    /// Exactly the boxes the site gives each role, in the order it shows them.
    var consentBoxes: [ConsentBox] {
        switch self {
        case .player:
            [ConsentBox(key: "terms", documents: [.terms]), ConsentBox(key: "personal_data", documents: [.consentPlayer, .privacy])]
        case .coach:
            [
                ConsentBox(key: "coach_offer", documents: [.coachOffer, .serviceTerms]),
                ConsentBox(key: "personal_data", documents: [.consentCoach, .privacy]),
                ConsentBox(key: "data_dissemination", documents: [.consentCoachDissemination]),
            ]
        }
    }
}

/// The sign-up form: what is typed, what is wrong with it (as the site words it), and the request it becomes.
public struct SignUpForm: Equatable, Sendable {
    public static let minPasswordLength = 12

    public enum Field: String, Sendable { case firstName, email, password, passwordConfirm, role }

    public var firstName = ""
    public var lastName = ""
    public var email = ""
    public var password = ""
    public var passwordConfirm = ""
    public private(set) var role: UserRole?
    /// The keys of the ticked boxes.
    public private(set) var accepted: Set<String> = []

    public init() {}

    /// Boxes belong to a role: choosing another role starts them over, so nothing ticked for the other role is ever sent.
    public mutating func choose(_ newRole: UserRole) {
        guard newRole != role else { return }
        role = newRole
        accepted = []
    }

    public mutating func set(_ box: ConsentBox, accepted isAccepted: Bool) {
        if isAccepted { accepted.insert(box.key) } else { accepted.remove(box.key) }
    }

    public func isAccepted(_ box: ConsentBox) -> Bool { accepted.contains(box.key) }

    /// A quick shape check so an obvious typo is caught before a round trip (the server's check is the real one).
    public static func looksLikeEmail(_ text: String) -> Bool {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.contains(where: \.isWhitespace) else { return false }
        let parts = value.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, let domain = Optional(parts[1]) else { return false }
        guard let dot = domain.lastIndex(of: ".") else { return false }
        let name = domain[..<dot], zone = domain[domain.index(after: dot)...]
        return !name.isEmpty && zone.count >= 2
    }

    /// What is wrong with the fields, by field.
    public func fieldErrors() -> [Field: String] {
        var found: [Field: String] = [:]
        if firstName.trimmingCharacters(in: .whitespaces).isEmpty { found[.firstName] = "Укажите имя." }
        if !Self.looksLikeEmail(email) { found[.email] = "Введите email полностью, например name@example.com." }
        if password.count < Self.minPasswordLength {
            found[.password] = "Пароль слишком короткий: минимум \(Self.minPasswordLength) символов."
        }
        if password != passwordConfirm { found[.passwordConfirm] = "Пароли не совпадают." }
        if role == nil { found[.role] = "Выберите, кто вы: игрок или тренер." }
        return found
    }

    /// The boxes of the chosen role that are not ticked yet.
    public func missingConsents() -> [ConsentBox] {
        (role?.consentBoxes ?? []).filter { !accepted.contains($0.key) }
    }

    /// The request, or nil while anything is missing.
    public func request() -> RegistrationRequest? {
        guard let role, fieldErrors().isEmpty, missingConsents().isEmpty else { return nil }
        let last = lastName.trimmingCharacters(in: .whitespaces)
        return RegistrationRequest(
            firstName: firstName.trimmingCharacters(in: .whitespaces), lastName: last.isEmpty ? nil : last,
            email: email.trimmingCharacters(in: .whitespaces), password: password, passwordConfirm: passwordConfirm, role: role,
            consents: role.consentBoxes.map(\.acceptance)
        )
    }

    /// The form field a server error belongs to (`first_name`, `password_confirm`…), when it names one.
    public static func field(forServer name: String?) -> Field? {
        switch name {
        case "first_name": .firstName
        case "email": .email
        case "password": .password
        case "password_confirm": .passwordConfirm
        case "role": .role
        default: nil
        }
    }
}
