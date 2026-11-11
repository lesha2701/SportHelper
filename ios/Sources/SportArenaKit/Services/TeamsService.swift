import Foundation

/// Teams: the list, one team with its people, creating and editing, leaving, and the way people get in (invitations and applications).
public final class TeamsService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func path(_ id: UUID, _ tail: String = "") -> String { "/api/teams/\(id.uuidString.lowercased())\(tail)" }

    public func mine() async throws -> [Team] { try await client.send(.get, "/api/teams/mine") }
    public func team(id: UUID) async throws -> Team { try await client.send(.get, path(id)) }
    public func members(of id: UUID) async throws -> [TeamMember] { try await client.send(.get, path(id, "/members")) }
    public func create(_ input: TeamInput) async throws -> Team { try await client.send(.post, "/api/teams", body: input) }
    public func update(id: UUID, _ input: TeamInput) async throws -> Team { try await client.send(.put, path(id), body: input) }
    /// Sets the team's logo (the head coach or an assistant coach; the server checks the picture and shrinks it). Answers the team as it is now.
    public func uploadLogo(of id: UUID, data: Data, filename: String = "logo.jpg", mimeType: String = "image/jpeg") async throws -> Team {
        try await client.upload(path(id, "/logo"), file: UploadFile(filename: filename, mimeType: mimeType, data: data))
    }
    public func leave(id: UUID) async throws { try await client.sendIgnoringResponse(.post, path(id, "/leave")) }

    // MARK: coaching staff

    /// Gives a person a new role ("captain", "assistant_coach" or "player").
    public func setRole(_ role: String, of user: UUID, in team: UUID) async throws {
        try await client.sendIgnoringResponse(.patch, path(team, "/members/\(user.uuidString.lowercased())"), body: MemberRoleBody(role: role))
    }

    public func remove(_ user: UUID, from team: UUID) async throws {
        try await client.sendIgnoringResponse(.delete, path(team, "/members/\(user.uuidString.lowercased())"))
    }

    /// The head coach hands the role to another member and stays in the team as an assistant coach.
    public func transferOwnership(of team: UUID, to member: TeamMember, teamName: String) async throws {
        let body = OwnershipTransferBody(toUserId: member.userId, confirmationPhrase: OwnershipTransfer.phrase(teamName: teamName, to: member))
        try await client.sendIgnoringResponse(.post, path(team, "/transfer-ownership"), body: body)
    }

    /// Removes a person and keeps them from applying again (the head coach only; the server has no way back).
    public func block(_ user: UUID, in team: UUID) async throws {
        try await client.sendIgnoringResponse(.post, path(team, "/members/\(user.uuidString.lowercased())/block"))
    }

    /// A fresh invitation for players (valid for a limited time).
    public func createInvite(for id: UUID) async throws -> TeamInvite {
        try await client.send(.post, path(id, "/invites"), body: InviteKind(kind: "join"))
    }

    public func applications(of id: UUID) async throws -> [JoinRequest] { try await client.send(.get, path(id, "/applications")) }

    public func accept(application: UUID, in team: UUID) async throws {
        try await client.sendIgnoringResponse(.post, path(team, "/applications/\(application.uuidString.lowercased())/accept"))
    }

    public func reject(application: UUID, in team: UUID) async throws {
        try await client.sendIgnoringResponse(.post, path(team, "/applications/\(application.uuidString.lowercased())/reject"))
    }

    // MARK: joining

    /// The team an invitation leads to, to show before the person applies.
    public func preview(token: String) async throws -> Team { try await client.send(.get, "/api/invites/\(try checked(token))") }

    public func apply(token: String) async throws -> JoinResult { try await client.send(.post, "/api/invites/\(try checked(token))/apply") }

    /// Only a well-formed token goes into a request path.
    private func checked(_ token: String) throws -> String {
        guard let valid = InviteToken.parse(token) else {
            throw APIError(status: 0, code: "invalid_invite", message: "Не удалось распознать приглашение. Вставьте ссылку или код целиком.")
        }
        return valid
    }
}

private struct InviteKind: Encodable, Sendable { let kind: String }
