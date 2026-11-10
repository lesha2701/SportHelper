import SportArenaKit
import SwiftUI

/// The site's review dialog: stars and an optional comment. The same dialog serves the athlete's review of a coach and the coach's
/// review of an athlete; the caller words it and does the sending (it returns the server's text when it failed).
struct ReviewSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    var hint: String?
    var skipLabel = "Отмена"
    let submit: (ReviewDraft) async -> String?

    @State private var draft = ReviewDraft()
    @State private var sending = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if let hint { Section { Text(hint).font(.footnote).foregroundStyle(.secondary) } }
                Section(sag: "Оценка") { stars }
                Section(sag: "Комментарий (необязательно)") {
                    TextField("Что понравилось, что можно улучшить", text: $draft.text, axis: .vertical)
                        .lineLimit(3...8)
                        .onChange(of: draft.text) { _, text in
                            if text.count > ReviewDraft.maxTextLength { draft.text = String(text.prefix(ReviewDraft.maxTextLength)) }
                        }
                        .accessibilityIdentifier("review.comment")
                }
                if let error {
                    Section { Text(error).foregroundStyle(Theme.danger).accessibilityIdentifier("review.error") }
                }
                Section {
                    Button {
                        Task { await send() }
                    } label: {
                        if sending { ProgressView().frame(maxWidth: .infinity) } else { Text("Отправить отзыв").frame(maxWidth: .infinity) }
                    }
                    .buttonStyle(.sag)
                    .disabled(sending || !draft.isReady)
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                    .accessibilityIdentifier("review.send")
                }
            }
            .sagScreen()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(skipLabel) { dismiss() }.disabled(sending).accessibilityIdentifier("review.skip")
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(sending)
    }

    private var stars: some View {
        HStack(spacing: 6) {
            ForEach(Array(ReviewDraft.stars), id: \.self) { star in
                Button { draft.rating = star } label: {
                    Image(systemName: star <= draft.rating ? "star.fill" : "star")
                        .font(.system(size: 30)).foregroundStyle(star <= draft.rating ? Theme.warning : Theme.textTertiary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderless)  // in a form row a plain button takes the tap of the whole row
                .accessibilityLabel("\(star) из 5")
                .accessibilityAddTraits(star == draft.rating ? .isSelected : [])
                .accessibilityIdentifier("review.star.\(star)")
            }
        }
    }

    private func send() async {
        sending = true
        error = nil
        defer { sending = false }
        if let failure = await submit(draft) { error = failure } else { dismiss() }
    }
}

/// What a booking offers once the session is held: the athlete's review of the coach, the coach's «Тренировка проведена» and review
/// of the athlete. (The rules are the site's, kept in `Booking`.)
struct BookingSessionActions: View {
    let booking: Booking
    let viewer: BookingCardView.Viewer
    var isWorking = false
    var onReview: (() -> Void)?
    var onComplete: (() -> Void)?
    var onReviewPlayer: (() -> Void)?

    var body: some View {
        switch viewer {
        case .athlete: athlete
        case .coach: coach
        }
    }

    @ViewBuilder private var athlete: some View {
        if booking.athleteCanReview, let onReview {
            Button(action: onReview) { Label("Оставить отзыв о тренере", systemImage: "star").frame(maxWidth: .infinity) }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("booking.review")
        } else if booking.hasReview {
            Label("Вы оставили отзыв о тренере", systemImage: "checkmark").font(.footnote).foregroundStyle(.secondary)
                .accessibilityIdentifier("booking.reviewed")
        }
    }

    @ViewBuilder private var coach: some View {
        if booking.status == .confirmed, booking.trainingStatus != "cancelled" {
            let now = Date()
            if booking.coachCanMarkConducted(now: now), let onComplete {
                Button(action: onComplete) {
                    if isWorking {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Label("Тренировка проведена", systemImage: "checkmark.circle").frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isWorking)
                .accessibilityIdentifier("booking.complete")
                Text("После отметки игрок получит просьбу оценить вас, а вы сможете оставить отзыв об игроке.")
                    .font(.caption).foregroundStyle(.secondary)
            } else if booking.trainingStatus == "scheduled", booking.startsAt > now {
                Text("Кнопка «Тренировка проведена» появится, когда занятие начнётся.").font(.caption).foregroundStyle(.secondary)
            }
            if booking.coachCanReviewPlayer(now: now), let onReviewPlayer {
                Button(action: onReviewPlayer) { Label("Оставить отзыв об игроке", systemImage: "star").frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("booking.reviewPlayer")
            } else if booking.hasPlayerReview {
                Label("Вы оставили отзыв об игроке", systemImage: "checkmark").font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("booking.playerReviewed")
            }
        }
    }
}

/// All the reviews of one coach (the server gives the latest fifty), newest first.
struct CoachReviewsView: View {
    @Environment(AuthStore.self) private var auth
    let coachUserId: UUID
    let coachName: String

    @State private var load: Load = .loading

    private enum Load {
        case loading, failed(String), loaded([CoachReview])
    }

    var body: some View {
        Group {
            switch load {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить отзывы", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await fetch() } }
                }
            case .loaded(let reviews):
                if reviews.isEmpty {
                    ContentUnavailableView("Отзывов пока нет", systemImage: "star")
                } else {
                    List(reviews) { ReviewRow(review: $0) }
                        .listStyle(.insetGrouped)
                        .accessibilityIdentifier("reviews.list")
                }
            }
        }
        .sagScreen()
        .navigationTitle("Отзывы: \(coachName)")
        .navigationBarTitleDisplayMode(.inline)
        .task { await fetch() }
    }

    private func fetch() async {
        do {
            load = .loaded(try await auth.coaches.reviews(ofCoach: coachUserId))
        } catch let error as APIError {
            load = .failed(error.message)
        } catch {
            load = .failed(APIError.unknown.message)
        }
    }
}

/// One review: who, how many stars, what they wrote and when.
struct ReviewRow: View {
    let review: CoachReview

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(review.athleteFirstName).font(.subheadline.weight(.semibold))
                Spacer()
                Label("\(review.rating)", systemImage: "star.fill").font(.footnote).foregroundStyle(Theme.warning)
                    .accessibilityLabel("Оценка \(review.rating) из 5")
            }
            if let text = review.text, !text.isEmpty { Text(text).font(.subheadline) }
            Text(review.createdAt.formatted(.dateTime.day().month(.abbreviated).year().locale(Locale(identifier: "ru_RU"))))
                .font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("review.row")
    }
}
