import SportArenaKit
import SwiftUI

/// What loading a page of somebody else ended in.
enum PageLoad<Value> {
    case loading
    case loaded(Value)
    case failed(String)
}

/// The top of a profile page: the picture (or the initial), the name and a line under it, on the site's dark panel.
struct ProfileHero: View {
    @Environment(AuthStore.self) private var auth
    let name: String
    let subtitle: String
    let avatar: UUID?
    var detail: String?

    var body: some View {
        HStack(spacing: 14) {
            AvatarView(store: auth.profile, fileId: avatar, initial: String(name.prefix(1)).uppercased(), size: 72)
            VStack(alignment: .leading, spacing: 4) {
                Text(name).font(Theme.display(24, weight: .heavy, relativeTo: .title2)).foregroundStyle(Theme.panelText)
                    .accessibilityAddTraits(.isHeader).accessibilityIdentifier("profilePage.name")
                if !subtitle.isEmpty { Text(subtitle).font(Theme.body(14, relativeTo: .subheadline)).foregroundStyle(Theme.panelMuted) }
                if let detail { Text(detail).font(Theme.body(13, weight: .semibold, relativeTo: .footnote)).foregroundStyle(Theme.panelText) }
            }
            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous).strokeBorder(Theme.panelBorder, lineWidth: 1))
        .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
    }
}

/// A coach as anyone sees them: who they are, their offers and what their players say.
struct CoachProfileView: View {
    @Environment(AuthStore.self) private var auth
    let coachUserId: UUID

    private struct Page {
        let profile: CoachPublicProfile
        let listings: [CoachListingCard]
        let reviews: [CoachReview]
    }

    @State private var load: PageLoad<Page> = .loading
    @State private var reporting: ReportTarget?

    var body: some View {
        Group {
            switch load {
            case .loading: ProgressView("Загрузка профиля…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить профиль", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await fetch() } }
                }
            case .loaded(let page): content(page)
            }
        }
        .sagScreen()
        .navigationTitle("Тренер")
        .navigationBarTitleDisplayMode(.inline)
        .reportSheet(item: $reporting)
        .task { await fetch() }
    }

    private func content(_ page: Page) -> some View {
        let profile = page.profile
        return List {
            Section {
                ProfileHero(
                    name: profile.fullName, subtitle: profile.subtitle, avatar: profile.avatarFileId,
                    detail: [
                        profile.experienceYears.map { "\(Russian.years($0)) опыта" },
                        profile.ratingText.map { "★ \($0) (\(profile.reviewCount))" },
                    ].compactMap { $0 }.joined(separator: " · ")
                )
            }
            if let text = profile.description, !text.isEmpty { Section(sag: "О себе") { Text(text) } }
            AchievementsSection(userId: profile.userId)
            Section(sag: "Объявления") {
                if page.listings.isEmpty { Text("Пока нет опубликованных объявлений.").foregroundStyle(.secondary) }
                ForEach(page.listings) { listing in
                    NavigationLink {
                        ListingDetailView(card: listing, store: auth.coaches)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(listing.title).font(.headline)
                            Text([listing.priceText ?? "Цена не указана", listing.location].compactMap { $0 }.joined(separator: " · "))
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("coachProfile.listing")
                }
            }
            Section(sag: "Отзывы (\(page.reviews.count))") {
                if page.reviews.isEmpty { Text("Пока нет отзывов.").foregroundStyle(.secondary) }
                ForEach(page.reviews) { ReviewRow(review: $0) }
            }
            if profile.userId != auth.user?.id {
                Section {
                    Button("Пожаловаться на профиль", systemImage: "flag") { reporting = .user(profile.userId) }
                        .accessibilityIdentifier("profilePage.report")
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier("coachProfile.list")
    }

    private func fetch() async {
        do {
            async let profile = auth.publicProfiles.coach(coachUserId)
            async let listings = auth.publicProfiles.listings(ofCoach: coachUserId)
            async let reviews = auth.coaches.reviews(ofCoach: coachUserId)
            load = .loaded(Page(profile: try await profile, listings: try await listings, reviews: try await reviews))
        } catch let error as APIError {
            load = .failed(error.message)
        } catch {
            load = .failed(APIError.unknown.message)
        }
    }
}

/// A player as their coach sees them: the data they gave, what coaches wrote about them, their achievements.
struct PlayerProfileView: View {
    @Environment(AuthStore.self) private var auth
    let playerUserId: UUID

    @State private var load: PageLoad<PlayerPublicProfile> = .loading
    /// Nil where the server does not show them (only a coach with a booking with this player reads them).
    @State private var reviews: PlayerReviews?
    @State private var reporting: ReportTarget?

    var body: some View {
        Group {
            switch load {
            case .loading: ProgressView("Загрузка профиля…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить профиль", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await fetch() } }
                }
            case .loaded(let profile): content(profile)
            }
        }
        .sagScreen()
        .navigationTitle("Игрок")
        .navigationBarTitleDisplayMode(.inline)
        .reportSheet(item: $reporting)
        .task { await fetch() }
    }

    private func content(_ profile: PlayerPublicProfile) -> some View {
        List {
            Section { ProfileHero(name: profile.fullName, subtitle: profile.subtitle, avatar: profile.avatarFileId) }
            let numbers = [
                profile.age.map { (Russian.years($0), "Возраст") }, profile.heightCm.map { ("\($0) см", "Рост") },
                profile.weightKg.map { ("\(LocalDateFormat.number($0)) кг", "Вес") },
            ].compactMap { $0 }
            if !numbers.isEmpty { Section { StatTiles(numbers).listRowInsets(EdgeInsets()).listRowBackground(Color.clear) } }
            Section {
                if let level = profile.skillLevel { LabeledContent("Уровень", value: level.title) }
                if let goals = profile.goals, !goals.isEmpty { note("Цели", goals) }
                if let limits = profile.loadRestrictions, !limits.isEmpty { note("Ограничения по нагрузке", limits) }
            }
            if let reviews { reviewsSection(reviews) }
            AchievementsSection(userId: profile.userId)
            if profile.userId != auth.user?.id {
                Section {
                    Button("Пожаловаться на профиль", systemImage: "flag") { reporting = .user(profile.userId) }
                        .accessibilityIdentifier("profilePage.report")
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier("playerProfile.list")
    }

    private func note(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(text)
        }
    }

    private func reviewsSection(_ reviews: PlayerReviews) -> some View {
        Section {
            if reviews.count == 0 {
                Text("Об этом игроке пока нет отзывов.").foregroundStyle(.secondary)
            } else if let average = reviews.averageText {
                Text("Средняя оценка: \(average) из 5 · отзывов: \(reviews.count)").font(.subheadline)
            }
            ForEach(reviews.reviews) { review in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(review.coachName).font(.subheadline.weight(.semibold))
                        Spacer()
                        Label("\(review.rating)", systemImage: "star.fill").font(.footnote).foregroundStyle(Theme.warning)
                            .accessibilityLabel("Оценка \(review.rating) из 5")
                    }
                    if let text = review.text, !text.isEmpty { Text(text).font(.subheadline) }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("playerProfile.review")
            }
        } header: {
            SagSectionHeader(title: "Отзывы тренеров")
        } footer: {
            Text("Отзывы оставляют тренеры после проведённых занятий; их видят только тренеры, у которых есть запись с этим игроком.")
        }
    }

    private func fetch() async {
        do {
            load = .loaded(try await auth.publicProfiles.player(playerUserId))
        } catch let error as APIError {
            load = .failed(error.code == "not_found" ? "Игрок ещё не заполнил профиль." : error.message)
            return
        } catch {
            load = .failed(APIError.unknown.message)
            return
        }
        reviews = try? await auth.publicProfiles.reviews(ofPlayer: playerUserId)
    }
}

/// A player whose page is to be shown.
struct PlayerRef: Identifiable {
    let id: UUID
}

extension View {
    /// Shows a player's page in a sheet (a list row full of buttons cannot also be a link).
    func playerProfileSheet(item: Binding<PlayerRef?>) -> some View {
        sheet(item: item) { ref in
            NavigationStack {
                PlayerProfileView(playerUserId: ref.id)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { PlayerProfileClose() }
                    }
            }
        }
    }
}

private struct PlayerProfileClose: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Button("Закрыть") { dismiss() }.accessibilityIdentifier("profilePage.close")
    }
}
