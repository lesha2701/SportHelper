import SportArenaKit
import SwiftUI

/// «Подбор клиентов» of a trainer: the terms and the switch «меня можно рекомендовать», and the offers of the administrators. The athlete's
/// name and contacts are not shown: the trainer sees only the request.
struct MatchOffersView: View {
    @Environment(AuthStore.self) private var auth

    @State private var settings: LoadState<MatchOfferSettings> = .loading
    @State private var offers: [CoachOffer] = []
    @State private var busy = false
    @State private var error: String?
    @State private var declining: CoachOffer?
    @State private var reason = ""

    var body: some View {
        Group {
            switch settings {
            case .loading:
                ProgressView("Загрузка…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await load() } }
                }
            case .loaded(let current):
                content(current)
            }
        }
        .sagScreen()
        .navigationTitle("Подбор клиентов")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .alert("Отказаться от клиента?", isPresented: Binding(get: { declining != nil }, set: { if !$0 { declining = nil } })) {
            TextField("Причина (необязательно)", text: $reason)
            Button("Отказаться", role: .destructive) { if let offer = declining { Task { await answer(offer, accept: false) } } }
            Button("Назад", role: .cancel) { reason = "" }
        }
    }

    private func content(_ current: MatchOfferSettings) -> some View {
        List {
            Section(current.termsTitle) {
                ForEach(current.terms, id: \.self) { paragraph in Text(paragraph).font(.subheadline) }
            }
            Section {
                Toggle("Меня можно рекомендовать", isOn: Binding(get: { current.enabled }, set: { value in Task { await toggle(value, current) } }))
                    .tint(Theme.primary).disabled(busy).accessibilityIdentifier("matchOffers.toggle")
                if !current.termsAccepted, current.acceptedVersion != nil {
                    Text("Условия обновились: чтобы получать предложения, включите подбор заново.").font(.footnote).foregroundStyle(.secondary)
                }
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.danger).accessibilityIdentifier("matchOffers.error") }
            } footer: {
                Text("Включая подбор, вы принимаете условия выше.")
            }
            Section(sag: "Предложения") {
                if offers.isEmpty {
                    Text("Предложений пока нет. Когда мы подберём вам клиента, он появится здесь.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(offers) { offer in OfferCard(offer: offer, busy: busy, onAccept: { Task { await answer(offer, accept: true) } }, onDecline: { reason = ""; declining = offer }) }
            }
        }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            async let loadedSettings = auth.matchOffers.settings()
            async let loadedOffers = auth.matchOffers.incoming()
            settings = .loaded(try await loadedSettings)
            offers = try await loadedOffers
        } catch let failure as APIError {
            if settings.value == nil { settings = .failed(failure.message) } else { error = failure.message }
        } catch {
            if settings.value == nil { settings = .failed(APIError.unknown.message) }
        }
    }

    private func toggle(_ enabled: Bool, _ current: MatchOfferSettings) async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            settings = .loaded(try await auth.matchOffers.setEnabled(enabled, termsVersion: current.currentVersion))
        } catch let failure as APIError {
            error = failure.message
            await load()
        } catch {
            self.error = APIError.unknown.message
        }
    }

    private func answer(_ offer: CoachOffer, accept: Bool) async {
        busy = true
        error = nil
        defer { busy = false; declining = nil }
        do {
            let updated = accept ? try await auth.matchOffers.accept(offer.id) : try await auth.matchOffers.decline(offer.id, reason: reason)
            offers = offers.map { $0.id == updated.id ? updated : $0 }
            reason = ""
        } catch let failure as APIError {
            error = failure.message
            await load()
        } catch {
            self.error = APIError.unknown.message
        }
    }
}

private struct OfferCard: View {
    let offer: CoachOffer
    let busy: Bool
    let onAccept: () -> Void
    let onDecline: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(offer.request.sport).font(Theme.body(16, weight: .semibold))
                Spacer()
                Text(offer.statusTitle).font(.caption.weight(.semibold)).padding(.horizontal, 10).padding(.vertical, 3)
                    .background(Color(.secondarySystemBackground), in: Capsule())
            }
            ForEach(offer.request.facts, id: \.label) { fact in
                HStack(alignment: .top) {
                    Text(fact.label).font(.footnote).foregroundStyle(.secondary).frame(width: 96, alignment: .leading)
                    Text(fact.value).font(.footnote)
                }
            }
            if let message = offer.adminMessage {
                HStack(alignment: .top) {
                    Text("От нас").font(.footnote).foregroundStyle(.secondary).frame(width: 96, alignment: .leading)
                    Text(message).font(.footnote)
                }
            }
            if offer.isWaiting {
                Text("За первую тренировку с этим клиентом платформа удерживает \(percent)% вместо обычной комиссии — это разово. Имя и контакты клиента откроются после его выбора и оплаты. Ответьте до \(offer.expiresAt.formatted(date: .abbreviated, time: .shortened)).")
                    .font(.footnote).foregroundStyle(.secondary)
                HStack {
                    Button("Принять клиента", action: onAccept).buttonStyle(.borderedProminent).tint(Theme.primary).disabled(busy)
                        .accessibilityIdentifier("matchOffers.accept")
                    Button("Отказаться", role: .destructive, action: onDecline).buttonStyle(.borderless).disabled(busy)
                        .accessibilityIdentifier("matchOffers.decline")
                }
                .font(.footnote)
            }
        }
        .padding(.vertical, 2)
    }

    private var percent: String {
        let value = offer.firstSessionPercent
        return value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value).replacingOccurrences(of: ".", with: ",")
    }
}
