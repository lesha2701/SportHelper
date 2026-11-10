import SportArenaKit
import SwiftUI

/// «Мои объявления»: the coach's offers (published and drafts), with the way to make, change and delete them.
struct MyListingsView: View {
    @Environment(AuthStore.self) private var auth

    private enum Load {
        case loading
        case loaded([CoachListing])
        case failed(String)
    }

    private enum Editing: Identifiable {
        case new
        case change(CoachListing)
        var id: String {
            switch self {
            case .new: "new"
            case .change(let listing): listing.id.uuidString
            }
        }
    }

    @State private var load = Load.loading
    @State private var editing: Editing?
    @State private var asking: CoachListing?
    @State private var deleting: Set<UUID> = []
    @State private var message: String?

    var body: some View {
        Group {
            switch load {
            case .loading: ProgressView("Загрузка объявлений…")
            case .failed(let text):
                ContentUnavailableView {
                    Label("Не удалось загрузить объявления", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(text)
                } actions: {
                    Button("Повторить") { Task { await reload() } }
                }
            case .loaded(let listings): list(listings)
            }
        }
        .sagScreen()
        .navigationTitle("Мои объявления")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { editing = .new } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Новое объявление").accessibilityIdentifier("myListings.new")
            }
        }
        .task { await reload() }
        .sheet(item: $editing) { mode in
            switch mode {
            case .new: ListingFormView(listing: nil) { Task { await reload() } }
            case .change(let listing): ListingFormView(listing: listing) { Task { await reload() } }
            }
        }
        .confirmationDialog(
            "Удалить «\(asking?.title ?? "")»?", isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }),
            titleVisibility: .visible
        ) {
            if let listing = asking {
                Button("Удалить", role: .destructive) { Task { await delete(listing) } }.accessibilityIdentifier("myListings.confirmDelete")
            }
        } message: {
            Text("Объявление пропадёт из каталога.")
        }
    }

    private func list(_ listings: [CoachListing]) -> some View {
        List {
            if let message {
                Section { Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.danger).accessibilityIdentifier("myListings.message") }
            }
            if listings.isEmpty {
                ContentUnavailableView {
                    Label("Объявлений пока нет", systemImage: "megaphone")
                } description: {
                    Text("Опубликуйте объявление, чтобы игроки могли найти вас и записаться.")
                } actions: {
                    Button("Новое объявление") { editing = .new }.buttonStyle(.sag).accessibilityIdentifier("myListings.empty.new")
                }
                .listRowBackground(Color.clear)
            }
            ForEach(listings) { listing in
                Button { editing = .change(listing) } label: { row(listing) }
                    .buttonStyle(.plain)
                    .disabled(deleting.contains(listing.id))
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) { asking = listing } label: { Label("Удалить", systemImage: "trash") }
                            .accessibilityIdentifier("myListings.delete")
                    }
                    .contextMenu {
                        Button("Изменить", systemImage: "pencil") { editing = .change(listing) }
                        Button("Удалить", systemImage: "trash", role: .destructive) { asking = listing }
                    }
                    .accessibilityIdentifier("myListings.row")
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await reload() }
        .accessibilityIdentifier("myListings.list")
    }

    private func row(_ listing: CoachListing) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(listing.title).font(.headline).foregroundStyle(Theme.text)
                Text([listing.priceText ?? "Цена не указана", listing.statusText].joined(separator: " · "))
                    .font(.subheadline).foregroundStyle(listing.hiddenByModeration ? Theme.danger : Theme.textSecondary)
                if listing.hiddenByModeration, let reason = listing.moderationReason, !reason.isEmpty {
                    Text(reason).font(.footnote).foregroundStyle(Theme.textSecondary)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.textTertiary)
        }
        .contentShape(Rectangle())
    }

    private func reload() async {
        do {
            load = .loaded(try await auth.listings.mine())
        } catch let error as APIError {
            if case .loaded = load { message = error.message } else { load = .failed(error.message) }
        } catch {
            if case .loaded = load { message = APIError.unknown.message } else { load = .failed(APIError.unknown.message) }
        }
    }

    private func delete(_ listing: CoachListing) async {
        message = nil
        deleting.insert(listing.id)
        defer { deleting.remove(listing.id) }
        do {
            try await auth.listings.delete(listing.id)
        } catch let error as APIError {
            message = error.code == "listing_has_active_booking"
                ? "Нельзя удалить объявление с активной бронью: сначала отклоните заявку или дождитесь окончания тренировки."
                : error.message
        } catch {
            message = APIError.unknown.message
        }
        await reload()
    }
}
