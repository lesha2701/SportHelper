import PhotosUI
import SportArenaKit
import SwiftUI

/// The report of an independent training: the player responsible for it writes what happened (and may add a photo and a video),
/// the coaching staff accepts it or sends it back with a comment. Everyone else in the team reads it.
struct TrainingReportView: View {
    @Environment(AuthStore.self) private var auth
    let training: Training
    /// The coaching staff of the team.
    let canReview: Bool

    @State private var load = LoadState<TrainingReport?>.loading
    @State private var text = ""
    @State private var comment = ""
    @State private var working = false
    @State private var notice: (text: String, isError: Bool)?
    @State private var photoItem: PhotosPickerItem?
    @State private var video: PickedVideo?
    @State private var videoProblem: String?
    @State private var showsPhoto = false

    private var isResponsible: Bool { training.responsibleUserId == auth.user?.id }

    var body: some View {
        Group {
            switch load {
            case .loading:
                ProgressView("Загрузка…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить отчёт", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await fetch() } }
                }
            case .loaded(let report):
                content(report)
            }
        }
        .sagScreen()
        .navigationTitle("Отчёт")
        .navigationBarTitleDisplayMode(.inline)
        .task { await fetch() }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task { await uploadPhoto(item) }
        }
        .onChange(of: video) { _, picked in
            guard let picked else { return }
            Task { await uploadVideo(picked) }
        }
        .fullScreenCover(isPresented: $showsPhoto) {
            if case .loaded(let report?) = load, let photo = report.photoFileId { PhotoScreen(fileId: photo, caption: "Фото к отчёту") }
        }
    }

    // MARK: content

    private func content(_ report: TrainingReport?) -> some View {
        List {
            if let notice {
                Section {
                    Label(notice.text, systemImage: notice.isError ? "exclamationmark.triangle" : "checkmark.circle")
                        .foregroundStyle(notice.isError ? .red : .green)
                        .accessibilityIdentifier("report.notice")
                }
            }
            if let report { Section { statusPill(report.status) } }
            if isResponsible {
                writing(report)
            } else {
                reading(report)
            }
            if let report {
                media(report)
                if let comment = report.coachComment, !comment.isEmpty {
                    Section(sag: "Комментарий тренера") { Text(comment).accessibilityIdentifier("report.coachComment") }
                }
                if canReview { review(report) }
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func writing(_ report: TrainingReport?) -> some View {
        Section {
            TextField("Как прошла тренировка, кто отсутствовал, что стоит отметить тренеру", text: $text, axis: .vertical)
                .lineLimit(4...12)
                .accessibilityIdentifier("report.text")
            Button(report == nil ? "Отправить отчёт" : "Обновить отчёт") { Task { await submit() } }
                .disabled(working || !ReportDraft(text: text).isReady)
                .accessibilityIdentifier("report.submit")
        } header: {
            Text("Отчёт о тренировке")
        } footer: {
            Text("\(ReportDraft(text: text).tidyText.count) из \(ReportDraft.maxLength)")
        }
    }

    @ViewBuilder
    private func reading(_ report: TrainingReport?) -> some View {
        if let report {
            Section(sag: "Отчёт о тренировке") { Text(report.textReport).accessibilityIdentifier("report.body") }
        } else {
            Section {
                Text("Отчёт ещё не отправлен").foregroundStyle(.secondary).accessibilityIdentifier("report.empty")
            }
        }
    }

    private func media(_ report: TrainingReport) -> some View {
        let canAttach = isResponsible
        return Section {
            if let photo = report.photoFileId {
                Button { showsPhoto = true } label: {
                    RemoteImageView(fileId: photo, contentMode: .fit).frame(maxHeight: 220)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Фото к отчёту")
                .accessibilityIdentifier("report.photo")
            }
            if canAttach {
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Label(report.photoFileId == nil ? "Фотография (необязательно)" : "Выбрать другое фото", systemImage: "photo")
                }
                .disabled(working)
                .accessibilityIdentifier("report.pickPhoto")
            }
            if let file = report.videoFileId { WatchVideoButton(fileId: file) }
            if canAttach {
                VideoAttachmentRow(
                    video: $video, hasUploaded: false, limitSeconds: nil, identifier: "report.pickVideo", problem: $videoProblem
                )
            }
            if let videoProblem { Text(videoProblem).foregroundStyle(.red).accessibilityIdentifier("report.videoProblem") }
            if working && canAttach { ProgressView().accessibilityIdentifier("report.uploading") }
        } header: {
            if report.photoFileId != nil || report.videoFileId != nil || canAttach { Text("Фото и видео") }
        }
    }

    private func review(_ report: TrainingReport) -> some View {
        Section {
            TextField("Комментарий (необязательно)", text: $comment, axis: .vertical)
                .lineLimit(2...6)
                .accessibilityIdentifier("report.comment")
            Button("Принять отчёт") { Task { await decide(.accepted) } }
                .disabled(working)
                .accessibilityIdentifier("report.accept")
            Button("Вернуть на доработку", role: .destructive) { Task { await decide(.needsRevision) } }
                .disabled(working)
                .accessibilityIdentifier("report.revise")
        } header: {
            Text("Решение тренера")
        } footer: {
            Text("Если вернуть отчёт, игрок увидит ваш комментарий и сможет отправить его заново.")
        }
    }

    private func statusPill(_ status: ReportStatus) -> some View {
        let color: Color = switch status {
        case .accepted: .green
        case .needsRevision: Theme.danger
        default: Theme.primary
        }
        return Text(status.title)
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 12).padding(.vertical, 4)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
            .accessibilityIdentifier("report.status")
    }

    // MARK: actions

    private func fetch() async {
        if case .loaded = load {} else { load = .loading }
        switch await apiResult({ [reports = auth.reports, id = training.id] in try await reports.report(of: id) }) {
        case .success(let report):
            if let report, text.isEmpty { text = report.textReport }
            load = .loaded(report)
        case .failure(let error):
            load = .failed(Self.russian(error).message)
        }
    }

    private func submit() async {
        let draft = ReportDraft(text: text)
        await perform("Отчёт отправлен.") { [reports = auth.reports, id = training.id] in try await reports.submit(draft, for: id) }
    }

    private func decide(_ decision: ReportDecision) async {
        let written = comment
        await perform(decision == .accepted ? "Отчёт принят." : "Отчёт возвращён на доработку.") { [reports = auth.reports, id = training.id] in
            try await reports.review(id, decision: decision, comment: written)
        }
        if notice?.isError == false { comment = "" }
    }

    private func uploadPhoto(_ item: PhotosPickerItem) async {
        defer { photoItem = nil }
        guard let data = try? await item.loadTransferable(type: Data.self), let jpeg = ImageEncoding.jpeg(from: data) else {
            notice = ("Не удалось прочитать фото. Выберите другое.", true)
            return
        }
        await perform("Фото добавлено.") { [reports = auth.reports, id = training.id] in try await reports.attachPhoto(jpeg, to: id) }
    }

    private func uploadVideo(_ picked: PickedVideo) async {
        defer { video = nil }
        await perform("Видео добавлено.") { [reports = auth.reports, id = training.id] in try await reports.attachVideo(picked.data, to: id) }
    }

    private func perform(_ success: String, _ work: @escaping @Sendable () async throws -> TrainingReport) async {
        working = true
        notice = nil
        defer { working = false }
        switch await apiResult(translate: Self.russian, work) {
        case .success(let report):
            load = .loaded(report)
            text = report.textReport
            notice = (success, false)
        case .failure(let error):
            notice = (error.message, true)
        }
    }

    /// The server's words for these cases are not always Russian: say them in the app's.
    nonisolated static func russian(_ error: APIError) -> APIError {
        let text: String? = switch error.code {
        case "report_required": "Сначала отправьте текст отчёта: фото и видео прикладываются после него."
        case "unsupported_media_type": "Такой файл не подходит: нужно фото или видео (MP4, MOV, WebM)."
        case "file_too_large": "Файл слишком большой. Для видео — не больше \(VideoRules.maxBytes / 1024 / 1024) МБ."
        case "storage_error", "yandex_disk_not_configured": "Не удалось сохранить файл. Попробуйте позже."
        case "forbidden": "Отчёт пишет ответственный игрок, а проверяет тренерский штаб команды."
        default: nil
        }
        return text.map(error.saying) ?? error
    }
}
