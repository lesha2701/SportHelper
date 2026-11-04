import Foundation

/// The signed-in person, as `POST /api/auth/login` and `GET /api/auth/me` return them (`csrf_token` included).
public struct AuthUser: Decodable, Equatable, Sendable, Identifiable {
    public let id: UUID
    public let email: String?
    public let emailVerified: Bool?
    public let firstName: String
    public let lastName: String?
    public let photoUrl: String?
    public let avatarFileId: UUID?
    public let languageCode: String?
    /// "player" or "coach": the part of the app they are working in. A person's role is chosen at sign-up and stays.
    public let activeMode: String?
    public let preferredRole: String?
    public let createdAt: Date
    public let isAdmin: Bool?
    public let hasPassword: Bool?
    public let deletionRequestedAt: Date?
    public let completedOnboardingVersion: Int?
    public let currentOnboardingVersion: Int?
    public let csrfToken: String

    public var fullName: String { [firstName, lastName].compactMap { $0 }.joined(separator: " ") }
    public var isCoach: Bool { (preferredRole ?? activeMode) == "coach" }
    public var needsOnboarding: Bool {
        guard let done = completedOnboardingVersion, let current = currentOnboardingVersion else { return false }
        return done < current
    }
}

/// What the server has switched on (`GET /api/features`, no sign-in needed). Hide the screens of anything that is off.
public struct ServerFeatures: Decodable, Equatable, Sendable {
    public let telegram: Bool
    public let payments: Bool
    public let trainerBalance: Bool
    public let trainerWithdrawals: Bool

    public init(telegram: Bool = false, payments: Bool = false, trainerBalance: Bool = false, trainerWithdrawals: Bool = false) {
        self.telegram = telegram
        self.payments = payments
        self.trainerBalance = trainerBalance
        self.trainerWithdrawals = trainerWithdrawals
    }

    /// A feature the server does not mention is off (an older server, a newer app).
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        telegram = try c.decodeIfPresent(Bool.self, forKey: .telegram) ?? false
        payments = try c.decodeIfPresent(Bool.self, forKey: .payments) ?? false
        trainerBalance = try c.decodeIfPresent(Bool.self, forKey: .trainerBalance) ?? false
        trainerWithdrawals = try c.decodeIfPresent(Bool.self, forKey: .trainerWithdrawals) ?? false
    }

    private enum CodingKeys: String, CodingKey { case telegram, payments, trainerBalance, trainerWithdrawals }
}

/// A short text answer of the server (`{"message": "..."}`).
public struct MessageResponse: Decodable, Equatable, Sendable {
    public let message: String
}
