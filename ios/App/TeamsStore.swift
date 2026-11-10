import Foundation
import Observation
import SportArenaKit

/// The person's teams, and the ways in: creating one, or joining with an invitation.
@MainActor
@Observable
final class TeamsStore {
    enum Load<Value: Equatable>: Equatable {
        case loading
        case loaded(Value)
        case failed(String)
    }

    private(set) var mine: Load<[Team]> = .loading
    let service: TeamsService

    init(client: APIClient) { service = TeamsService(client: client) }

    func reloadMine() async {
        if case .loaded = mine {} else { mine = .loading }
        do {
            mine = .loaded(try await service.mine())
        } catch let error as APIError {
            mine = .failed(error.message)
        } catch {
            mine = .failed(APIError.unknown.message)
        }
    }

    func create(_ input: TeamInput) async -> Result<Team, APIError> {
        let result = await run { try await self.service.create(input) }
        if case .success = result { await reloadMine() }
        return result
    }

    func update(_ team: Team, _ input: TeamInput) async -> Result<Team, APIError> {
        let result = await run { try await self.service.update(id: team.id, input) }
        if case .success = result { await reloadMine() }
        return result
    }

    /// Leaves the team. Returns the server's error text, or nil.
    func leave(_ team: Team) async -> String? {
        switch await run({ try await self.service.leave(id: team.id) }) {
        case .success:
            if case .loaded(let list) = mine { mine = .loaded(list.filter { $0.id != team.id }) }
            return nil
        case .failure(let error):
            return error.message
        }
    }

    func preview(_ token: String) async -> Result<Team, APIError> { await run { try await self.service.preview(token: token) } }

    func apply(_ token: String) async -> Result<JoinResult, APIError> {
        let result = await run { try await self.service.apply(token: token) }
        if case .success(let joined) = result, joined.joined { await reloadMine() }
        return result
    }

    func detail(for team: Team) -> TeamDetailModel { TeamDetailModel(team: team, service: service) }

    func reset() { mine = .loading }

    private func run<Value: Sendable>(_ work: @escaping () async throws -> Value) async -> Result<Value, APIError> {
        do {
            return .success(try await work())
        } catch let error as APIError {
            return .failure(error.code == "coach_profile_required"
                ? APIError(status: error.status, code: error.code, message: "Чтобы создать команду, сначала заполните профиль тренера.")
                : error)
        } catch {
            return .failure(.unknown)
        }
    }
}

/// One team's screen: the team itself, its people, and for the coaching staff the applications and the invitation.
@MainActor
@Observable
final class TeamDetailModel {
    enum Load<Value: Equatable>: Equatable {
        case loading
        case loaded(Value)
        case failed(String)

        var value: Value? { if case .loaded(let value) = self { value } else { nil } }
    }

    private(set) var team: Team
    private(set) var members: Load<[TeamMember]> = .loading
    private(set) var applications: [JoinRequest] = []
    private(set) var invite: TeamInvite?
    private(set) var busy: Set<UUID> = []
    /// The last answer or error, shown at the top of the screen.
    private(set) var notice: (text: String, isError: Bool)?
    private let service: TeamsService

    init(team: Team, service: TeamsService) {
        self.team = team
        self.service = service
    }

    func load() async {
        if let fresh = try? await service.team(id: team.id) { team = fresh }
        do {
            members = .loaded(try await service.members(of: team.id))
        } catch let error as APIError {
            members = .failed(error.message)
        } catch {
            members = .failed(APIError.unknown.message)
        }
        if team.canManage { applications = (try? await service.applications(of: team.id)) ?? applications }
    }

    func createInvite() async {
        do {
            invite = try await service.createInvite(for: team.id)
            notice = nil
        } catch let error as APIError {
            notice = (error.message, true)
        } catch {
            notice = (APIError.unknown.message, true)
        }
    }

    func answer(_ request: JoinRequest, accept: Bool) async {
        busy.insert(request.id)
        defer { busy.remove(request.id) }
        do {
            if accept { try await service.accept(application: request.id, in: team.id) } else { try await service.reject(application: request.id, in: team.id) }
            applications.removeAll { $0.id == request.id }
            notice = (accept ? "\(request.fullName) теперь в команде." : "Заявка от \(request.fullName) отклонена.", false)
            if accept { await load() }
        } catch let error as APIError {
            notice = (error.message, true)
            applications = (try? await service.applications(of: team.id)) ?? applications  // it may already have been answered
        } catch {
            notice = (APIError.unknown.message, true)
        }
    }

    func updated(_ newTeam: Team) { team = newTeam }

    /// Hands the head coach's role to another member; the person stays as an assistant coach. Nil when it went through, else the error text.
    func transferOwnership(to member: TeamMember) async -> String? {
        do {
            try await service.transferOwnership(of: team.id, to: member, teamName: team.name)
            notice = ("\(member.fullName) теперь главный тренер. Вы остались помощником тренера.", false)
            await load()
            return nil
        } catch let error as APIError {
            return OwnershipTransfer.russian(error).message
        } catch {
            return APIError.unknown.message
        }
    }

    /// A role change, removal or block of one person. The list is read again afterwards.
    func perform(_ action: RosterAction, on member: TeamMember) async {
        busy.insert(member.userId)
        defer { busy.remove(member.userId) }
        do {
            switch action {
            case .remove: try await service.remove(member.userId, from: team.id)
            case .block: try await service.block(member.userId, in: team.id)
            default:
                guard let role = action.newRole else { return }
                try await service.setRole(role, of: member.userId, in: team.id)
            }
            notice = (Self.done(action, member.fullName), false)
            await load()
        } catch let error as APIError {
            notice = (RosterAction.russian(error).message, true)
        } catch {
            notice = (APIError.unknown.message, true)
        }
    }

    private static func done(_ action: RosterAction, _ name: String) -> String {
        switch action {
        case .makeCaptain: "\(name) теперь капитан."
        case .removeCaptain: "\(name) больше не капитан."
        case .makeAssistant: "\(name) теперь помощник тренера."
        case .removeAssistant: "\(name) больше не помощник тренера."
        case .remove: "\(name) удалён из команды."
        case .block: "\(name) заблокирован."
        }
    }
}
