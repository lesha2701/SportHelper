import Foundation

public enum UserRole: String, Codable, Sendable { case player, coach }

/// One ticked box on the sign-up form and the documents (with their editions) it covered.
/// The keys and editions come from the server's legal documents; the app must send exactly what the person was shown.
public struct ConsentAcceptance: Codable, Equatable, Sendable {
    public struct Document: Codable, Equatable, Sendable {
        public let key: String
        public let version: String
        public init(key: String, version: String) { self.key = key; self.version = version }
    }

    public let key: String
    public let documents: [Document]
    public init(key: String, documents: [Document]) { self.key = key; self.documents = documents }
}

public struct RegistrationRequest: Encodable, Sendable {
    public var firstName: String
    public var lastName: String?
    public var email: String
    public var password: String
    public var passwordConfirm: String
    public var role: UserRole
    public var consents: [ConsentAcceptance]

    public init(firstName: String, lastName: String? = nil, email: String, password: String, passwordConfirm: String, role: UserRole, consents: [ConsentAcceptance]) {
        self.firstName = firstName
        self.lastName = lastName
        self.email = email
        self.password = password
        self.passwordConfirm = passwordConfirm
        self.role = role
        self.consents = consents
    }
}

/// The answer to sign-up: a confirmation link has been sent to this address.
public struct RegistrationResult: Decodable, Equatable, Sendable {
    public let email: String
    public let verificationSent: Bool?
}
