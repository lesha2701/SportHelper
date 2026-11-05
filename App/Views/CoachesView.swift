import SportArenaKit
import SwiftUI

/// The catalogue of trainers' offers (the «Тренеры» tab).
struct CoachesView: View {
    @Environment(AuthStore.self) private var auth
    @Bindable var store: CoachesStore
    @State private var query = ""
    /// Shown inside another navigation stack (a coach reaches the catalogue from the profile) instead of being a tab of its own.
    var embedded = false

    var body: some View {
        if embedded { screen } else { NavigationStack { screen } }
    }

    private var screen: some View {
        content
            .sagMainBar("Тренеры")
            .searchable(text: $query, prompt: "Имя тренера или объявление")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { filterMenu } }
            .task(id: store.filter) { await store.reload() }
            .navigationDestination(for: CoachListingCard.self) { ListingDetailView(card: $0, store: store) }
    }

    @ViewBuilder private var content: some View {
        switch store.load {
        case .loading:
            ProgressView("Загрузка…").frame(maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("Не удалось загрузить тренеров", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Повторить") { Task { await store.reload() } }
            }
        case .loaded(let all):
            let shown = visible(all)
            if shown.isEmpty {
                ContentUnavailableView(
                    all.isEmpty ? "Пока нет объявлений" : "Ничего не найдено",
                    systemImage: "person.2",
                    description: Text(store.filter.isEmpty && query.isEmpty
                         ? "Когда тренеры опубликуют объявления, они появятся здесь." : "Попробуйте изменить поиск или фильтры.")
                )
            } else {
                List(shown) { listing in
                    NavigationLink(value: listing) { ListingCardView(listing: listing) }
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .accessibilityIdentifier("coaches.listing")
                }
                .listStyle(.plain)
                .refreshable { await store.reload() }
                .accessibilityIdentifier("coaches.list")
            }
        }
    }

    /// Own offers are not shown to their author (a trainer does not book a lesson with themselves); then the text search.
    private func visible(_ all: [CoachListingCard]) -> [CoachListingCard] {
        let mine = auth.user?.id
        let text = query.trimmed.lowercased()
        return all.filter { listing in
            listing.coachUserId != mine
                && (text.isEmpty || listing.title.lowercased().contains(text) || listing.coachFullName.lowercased().contains(text))
        }
    }

    private var filterMenu: some View {
        Menu {
            Picker("Вид спорта", selection: $store.filter.sport) {
                Text("Любой спорт").tag(String?.none)
                ForEach(CommonSports.all, id: \.self) { Text($0).tag(String?.some($0)) }
            }
            Picker("Формат", selection: $store.filter.format) {
                Text("Любой формат").tag(BookingFormat?.none)
                ForEach(BookingFormat.allCases) { Text($0.title).tag(BookingFormat?.some($0)) }
            }
            if !store.filter.isEmpty { Button("Сбросить фильтры", role: .destructive) { store.filter = CoachFilter() } }
        } label: {
            Image(systemName: store.filter.isEmpty ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
        .accessibilityLabel("Фильтры")
        .accessibilityIdentifier("coaches.filter")
    }
}

extension CoachListingCard: Hashable {
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct ListingCardView: View {
    let listing: CoachListingCard

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RemoteImageView(fileId: listing.photoFileId)
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 4) {
                Text(listing.title).font(.headline).lineLimit(2)
                Text(listing.coachFullName).font(.subheadline).foregroundStyle(.secondary)
                Text([listing.sport, listing.specialization].compactMap { $0 }.joined(separator: " · ")).font(.footnote).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    if let price = listing.priceText { Text(price).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.primary) }
                    if let rating = listing.ratingText { Label(rating, systemImage: "star.fill").font(.footnote).foregroundStyle(.orange) }
                    Text(listing.formats.map(\.title).joined(separator: ", ")).font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }
}
