import SportArenaKit
import SwiftUI

/// One offer: who, what, how much, and the way to book it.
struct ListingDetailView: View {
    @Environment(AuthStore.self) private var auth
    let card: CoachListingCard
    let store: CoachesStore

    private enum Load {
        case loading
        case loaded(CoachListingProfile)
        case failed(String)
    }

    @State private var load = Load.loading
    @State private var booking = false
    @State private var reporting: ReportTarget?

    var body: some View {
        Group {
            switch load {
            case .loading: ProgressView("Загрузка…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить объявление", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await fetch() } }
                }
            case .loaded(let profile): details(profile)
            }
        }
        .sagScreen()
        .navigationTitle("Объявление")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // not on one's own listing: the server would refuse, and there is nothing to report
            if case .loaded(let profile) = load, profile.coachUserId != auth.user?.id {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Пожаловаться на объявление", systemImage: "flag") { reporting = .listing(profile.id) }
                            .accessibilityIdentifier("listing.report")
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("Ещё")
                    .accessibilityIdentifier("listing.more")
                }
            }
        }
        .reportSheet(item: $reporting)
        .task { await fetch() }
    }

    private func details(_ profile: CoachListingProfile) -> some View {
        List {
            Section {
                RemoteImageView(fileId: profile.photoFileId).frame(height: 180).listRowInsets(EdgeInsets())
            }
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(profile.title).font(.title3.bold()).accessibilityIdentifier("listing.title")
                    NavigationLink {
                        CoachProfileView(coachUserId: profile.coachUserId)
                    } label: {
                        Label(profile.coachFullName, systemImage: "person.crop.circle").foregroundStyle(Theme.primary)
                    }
                    .accessibilityIdentifier("listing.coachProfile")
                }
                if let price = profile.priceText { LabeledContent("Стоимость", value: price) }
                LabeledContent("Вид спорта", value: profile.sport)
                if let minutes = profile.sessionDurationMinutes { LabeledContent("Длительность", value: "\(minutes) мин") }
                LabeledContent("Формат", value: profile.formats.map(\.title).joined(separator: ", "))
                if let location = profile.location, !location.isEmpty { LabeledContent("Место", value: location) }
                if let years = profile.experienceYears { LabeledContent("Опыт тренера", value: Russian.years(years)) }
                if let rating = card.ratingText { LabeledContent("Рейтинг", value: "\(rating) (\(profile.reviewCount))") }
            }
            if let text = profile.description, !text.isEmpty { Section(sag: "Об услуге") { Text(text) } }
            if let text = profile.coachDescription, !text.isEmpty { Section(sag: "О тренере") { Text(text) } }
            if !profile.recentReviews.isEmpty {
                Section(sag: "Отзывы") {
                    ForEach(profile.recentReviews) { ReviewRow(review: $0) }
                    if profile.reviewCount > profile.recentReviews.count {
                        NavigationLink("Все отзывы (\(profile.reviewCount))") {
                            CoachReviewsView(coachUserId: profile.coachUserId, coachName: profile.coachFullName)
                        }
                        .accessibilityIdentifier("listing.allReviews")
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            Button { booking = true } label: { Text("Записаться").bold().frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(profile.formats.isEmpty)
                .accessibilityIdentifier("listing.book")
                .padding(.horizontal).padding(.vertical, 8)
                .background(.bar)
        }
        .sheet(isPresented: $booking) { BookingFlowView(profile: profile, store: store) }
    }

    private func fetch() async {
        load = .loading
        do {
            load = .loaded(try await store.listing(id: card.id))
        } catch let error as APIError {
            load = .failed(error.message)
        } catch {
            load = .failed(APIError.unknown.message)
        }
    }
}
