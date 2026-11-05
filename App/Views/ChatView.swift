import AVKit
import PhotosUI
import SportArenaKit
import SwiftUI

extension ChatAttachment: Identifiable {
    public var id: UUID { fileId }
}

/// A conversation: the messages of a personal training or of a team, and the field to write in.
struct ChatView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.scenePhase) private var scenePhase
    @State private var store: ChatStore
    @State private var draft = ""
    @State private var photoItem: PhotosPickerItem?
    @State private var deleting: ChatMessage?
    @State private var notice: String?
    @State private var viewing: ChatAttachment?
    @State private var reloads = 0

    init(store: ChatStore) { _store = State(initialValue: store) }

    private struct RunKey: Hashable {
        let active: Bool
        let reloads: Int
    }

    var body: some View {
        Group {
            switch store.conversation {
            case .loading:
                ProgressView("Загрузка чата…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Чат не открылся", systemImage: "exclamationmark.bubble")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { reloads += 1 }
                }
            case .loaded(let info):
                conversation(info)
            }
        }
        .sagScreen()
        .navigationTitle(store.conversationInfo?.title ?? "Чат")
        .navigationBarTitleDisplayMode(.inline)
        // Polling runs only while the app is on screen: nothing is fetched in the background.
        .task(id: RunKey(active: scenePhase == .active, reloads: reloads)) {
            guard scenePhase == .active else { return }
            if store.conversationInfo == nil { await store.open() }
            if store.conversationInfo != nil { await store.poll() }
        }
        .fullScreenCover(item: $viewing) { AttachmentViewer(attachment: $0) }
        .confirmationDialog("Удалить сообщение?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Удалить", role: .destructive) {
                guard let message = deleting else { return }
                Task { notice = await store.delete(message) }
            }
        } message: {
            Text("Оно исчезнет у всех участников чата.")
        }
    }

    // MARK: conversation

    private func conversation(_ info: ChatConversation) -> some View {
        VStack(spacing: 0) {
            if store.offline {
                Label("Нет связи. Пробуем снова…", systemImage: "wifi.slash")
                    .font(.footnote).foregroundStyle(.secondary).padding(6).frame(maxWidth: .infinity).background(.bar)
                    .accessibilityIdentifier("chat.offline")
            }
            messages(info)
            if let notice { Text(notice).font(.footnote).foregroundStyle(.red).padding(.horizontal).accessibilityIdentifier("chat.notice") }
            composer(info)
        }
    }

    private func messages(_ info: ChatConversation) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 6) {
                    if store.thread.hasMoreBefore {
                        Button {
                            let anchor = store.thread.oldestID
                            Task {
                                await store.loadOlder()
                                if let anchor { proxy.scrollTo("m-\(anchor)", anchor: .top) }
                            }
                        } label: {
                            if store.isLoadingOlder { ProgressView() } else { Text("Показать ранние сообщения").font(.footnote) }
                        }
                        .padding(8)
                        .accessibilityIdentifier("chat.older")
                    }
                    if store.thread.isEmpty && store.outgoing.isEmpty {
                        Text(info.canSend ? "Сообщений пока нет. Напишите первым." : "Сообщений нет.")
                            .font(.subheadline).foregroundStyle(.secondary).padding(.top, 40)
                    }
                    ForEach(rows) { row in
                        switch row.kind {
                        case .day(let date):
                            Text(ChatFormat.dayTitle(date)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                .padding(.vertical, 6)
                        case .message(let message):
                            bubble(message, info: info).id("m-\(message.id)")
                        case .outgoing(let item):
                            OutgoingBubble(
                                item: item,
                                onRetry: { Task { await store.retry(item.id) } },
                                onDiscard: { store.discard(item.id) }
                            )
                        }
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 12)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: store.thread.newestID) { withAnimation { proxy.scrollTo("bottom") } }
            .onChange(of: store.outgoing.count) { withAnimation { proxy.scrollTo("bottom") } }
            .accessibilityIdentifier("chat.messages")
        }
    }

    private func bubble(_ message: ChatMessage, info: ChatConversation) -> some View {
        MessageBubble(
            message: message, mine: store.isMine(message), showName: info.kind == "team",
            canDelete: store.canDelete(message), onDelete: { deleting = message }, onOpen: { viewing = $0 }
        )
    }

    // MARK: composer

    @ViewBuilder private func composer(_ info: ChatConversation) -> some View {
        if info.canSend {
            VStack(spacing: 4) {
                if draft.count > ChatLimits.maxMessageLength - 200 {
                    Text("\(draft.count) / \(ChatLimits.maxMessageLength)")
                        .font(.caption2).foregroundStyle(draft.count > ChatLimits.maxMessageLength ? .red : .secondary)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                HStack(alignment: .bottom, spacing: 8) {
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Image(systemName: "photo").font(.title3).frame(width: 36, height: 36)
                    }
                    .accessibilityLabel("Прикрепить фото")
                    .accessibilityIdentifier("chat.photo")
                    TextField("Сообщение", text: $draft, axis: .vertical)
                        .lineLimit(1...5)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
                        .accessibilityIdentifier("chat.input")
                    Button {
                        let text = draft
                        draft = ""
                        Task { await store.send(text) }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill").font(.system(size: 34))
                    }
                    .disabled(ChatStore.prepared(draft) == nil)
                    .accessibilityLabel("Отправить")
                    .accessibilityIdentifier("chat.send")
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(.bar)
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                photoItem = nil
                Task { await sendPhoto(item) }
            }
        } else {
            Text(info.sendBlockedReason ?? "В этот чат нельзя писать.")
                .font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(12).background(.bar)
                .accessibilityIdentifier("chat.closed")
        }
    }

    private func sendPhoto(_ item: PhotosPickerItem) async {
        notice = nil
        guard let data = try? await item.loadTransferable(type: Data.self), let jpeg = ImageEncoding.jpeg(from: data) else {
            notice = "Не удалось прочитать фото."
            return
        }
        await store.sendPhoto(jpeg)
    }

    // MARK: rows

    private struct Row: Identifiable {
        enum Kind {
            case day(Date)
            case message(ChatMessage)
            case outgoing(ChatStore.Outgoing)
        }
        let id: String
        let kind: Kind
    }

    private var rows: [Row] {
        var result: [Row] = []
        var lastDay: Date?
        let calendar = Calendar.current
        for message in store.thread.messages {
            let day = calendar.startOfDay(for: message.createdAt)
            if day != lastDay {
                result.append(Row(id: "d-\(day.timeIntervalSince1970)", kind: .day(day)))
                lastDay = day
            }
            result.append(Row(id: "m-\(message.id)", kind: .message(message)))
        }
        for item in store.outgoing { result.append(Row(id: "o-\(item.id)", kind: .outgoing(item))) }
        return result
    }
}

enum ChatFormat {
    static func time(_ date: Date) -> String { date.formatted(.dateTime.hour().minute().locale(Locale(identifier: "ru_RU"))) }

    static func dayTitle(_ day: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return "Сегодня" }
        if calendar.isDateInYesterday(day) { return "Вчера" }
        let sameYear = calendar.isDate(day, equalTo: Date(), toGranularity: .year)
        return day.formatted((sameYear ? Date.FormatStyle().day().month(.wide) : Date.FormatStyle().day().month(.wide).year()).locale(Locale(identifier: "ru_RU")))
    }
}

// MARK: bubbles

private struct MessageBubble: View {
    let message: ChatMessage
    let mine: Bool
    let showName: Bool
    let canDelete: Bool
    let onDelete: () -> Void
    let onOpen: (ChatAttachment) -> Void

    var body: some View {
        HStack {
            if mine { Spacer(minLength: 48) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
                if showName && !mine { Text(message.senderName).font(.caption.weight(.semibold)).foregroundStyle(Theme.primary) }
                content
                Text(ChatFormat.time(message.createdAt)).font(.caption2).foregroundStyle(.secondary)
            }
            if !mine { Spacer(minLength: 48) }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var content: some View {
        if message.deleted {
            Text("Сообщение удалено").italic().font(.subheadline).foregroundStyle(.secondary)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(.secondary.opacity(0.4)))
        } else {
            VStack(alignment: .leading, spacing: 6) {
                if let attachment = message.attachment { AttachmentThumbnail(attachment: attachment).onTapGesture { onOpen(attachment) } }
                if let body = message.body, !body.isEmpty {
                    Text(body).textSelection(.disabled).accessibilityIdentifier("chat.message")
                }
            }
            .padding(.horizontal, message.attachment == nil ? 12 : 6).padding(.vertical, message.attachment == nil ? 8 : 6)
            .foregroundStyle(mine ? Color.white : Color.primary)
            .background(mine ? Theme.primary : Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
            .contextMenu {
                if let body = message.body, !body.isEmpty { Button("Копировать", systemImage: "doc.on.doc") { UIPasteboard.general.string = body } }
                if canDelete { Button("Удалить", systemImage: "trash", role: .destructive, action: onDelete) }
            }
        }
    }
}

private struct OutgoingBubble: View {
    let item: ChatStore.Outgoing
    let onRetry: () -> Void
    let onDiscard: () -> Void

    var body: some View {
        HStack {
            Spacer(minLength: 48)
            VStack(alignment: .trailing, spacing: 4) {
                VStack(alignment: .leading, spacing: 6) {
                    if let photo = item.photo, let image = UIImage(data: photo) {
                        Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: 220, maxHeight: 260).clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    if !item.text.isEmpty { Text(item.text) }
                }
                .padding(.horizontal, item.photo == nil ? 12 : 6).padding(.vertical, item.photo == nil ? 8 : 6)
                .foregroundStyle(.white)
                .background(Theme.primary.opacity(item.failure == nil ? 0.6 : 0.35), in: RoundedRectangle(cornerRadius: 16))
                if let failure = item.failure {
                    Text(failure).font(.caption).foregroundStyle(.red).multilineTextAlignment(.trailing).accessibilityIdentifier("chat.failed")
                    HStack(spacing: 12) {
                        Button("Повторить", action: onRetry).accessibilityIdentifier("chat.retry")
                        Button("Удалить", role: .destructive, action: onDiscard)
                    }
                    .font(.caption.weight(.semibold))
                } else {
                    Text("Отправляется…").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// The small picture (or the video tile) inside a message.
private struct AttachmentThumbnail: View {
    let attachment: ChatAttachment
    @Environment(AuthStore.self) private var auth
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12).fill(Color.black.opacity(0.08))
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else if attachment.kind == .photo {
                ProgressView()
            }
            if attachment.kind == .video {
                Image(systemName: "play.circle.fill").font(.system(size: 44)).foregroundStyle(.white).shadow(radius: 3)
            }
        }
        .frame(width: 220, height: 160)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel(attachment.kind == .photo ? "Фото" : "Видео")
        .accessibilityAddTraits(.isButton)
        .task(id: attachment.fileId) {
            image = await auth.profile.image(for: attachment.fileId, thumbnail: true)
        }
    }
}

/// A photo or a video from a chat, full screen.
private struct AttachmentViewer: View {
    let attachment: ChatAttachment
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var player: AVPlayer?
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if let player {
                    VideoPlayer(player: player)
                } else if let image {
                    Image(uiImage: image).resizable().scaledToFit()
                } else if failed {
                    Text("Не удалось загрузить файл.").foregroundStyle(.white)
                } else {
                    ProgressView().tint(.white)
                }
            }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Закрыть") { dismiss() } } }
            .toolbarBackground(.black, for: .navigationBar)
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            switch attachment.kind {
            case .photo:
                image = await auth.profile.image(for: attachment.fileId, thumbnail: false)
                failed = image == nil
            case .video:
                if let url = await auth.profile.temporaryFile(for: attachment.fileId, name: attachment.filename) {
                    let player = AVPlayer(url: url)
                    self.player = player
                    player.play()
                } else {
                    failed = true
                }
            }
        }
        .onDisappear { player?.pause() }
    }
}
