import Foundation

/// Whether a member was at a training. A training marked as held counts everyone as present until the coach marks someone absent.
public enum AttendanceStatus: String, Codable, Sendable, CaseIterable {
    case present, absent

    public var title: String { self == .present ? "Был" : "Не был" }
    public var flipped: AttendanceStatus { self == .present ? .absent : .present }
}

/// One member's line of a training's attendance (`GET /api/trainings/{id}/attendance`).
public struct Attendance: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let trainingId: UUID
    public let userId: UUID
    public let firstName: String
    public let lastName: String?
    public let statusRaw: String
    public let markedBy: UUID?
    public let markedAt: Date

    public var id: UUID { userId }
    public var fullName: String { [firstName, lastName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ") }
    /// Unknown values read as present: that is what the server assumes for anyone it has not heard about.
    public var status: AttendanceStatus { AttendanceStatus(rawValue: statusRaw) ?? .present }

    private enum CodingKeys: String, CodingKey {
        case trainingId, userId, firstName, lastName, markedBy, markedAt
        case statusRaw = "status"
    }

    public init(trainingId: UUID, userId: UUID, firstName: String, lastName: String?, status: AttendanceStatus, markedBy: UUID?, markedAt: Date) {
        self.trainingId = trainingId
        self.userId = userId
        self.firstName = firstName
        self.lastName = lastName
        statusRaw = status.rawValue
        self.markedBy = markedBy
        self.markedAt = markedAt
    }
}

public extension Training {
    /// Attendance is kept for the trainings of a team (its own and the independent ones), not for personal trainings.
    var hasAttendance: Bool { type == "team" || type == "independent" }
}

public extension Array where Element == Attendance {
    /// The players who were absent, in the order of the list.
    var absentees: [Attendance] { filter { $0.status == .absent } }

    /// "Были 8 из 10".
    var summary: String {
        let present = filter { $0.status == .present }.count
        return "Были \(present) из \(count)"
    }
}

struct AttendanceBody: Encodable, Sendable {
    let status: String
}
