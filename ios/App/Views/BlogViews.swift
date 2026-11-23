import SportArenaKit
import SwiftUI

/// The article's text with its markers shown as bold and italic (text only: nothing an author types becomes anything else).
enum BlogText {
    static func attributed(_ text: String) -> AttributedString {
        var result = AttributedString()
        for run in BlogMarkup.runs(text) {
            var piece = AttributedString(run.text)
            var intent: InlinePresentationIntent = []
            if run.bold { intent.insert(.stronglyEmphasized) }
            if run.italic { intent.insert(.emphasized) }
            if !intent.isEmpty { piece.inlinePresentationIntent = intent }
            result.append(piece)
        }
        return result
    }

    static func date(_ date: Date?) -> String {
        date?.formatted(.dateTime.day().month(.wide).year().locale(Locale(identifier: "ru_RU"))) ?? ""
    }

    static func message(_ error: Error) -> String { (error as? APIError)?.message ?? APIError.unknown.message }
}

/// The blocks of an article, one under another.
struct BlogBodyView: View {
    let blocks: [PostBlock]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(blocks) { block in
                switch block.type {
                case .heading:
                    Text(BlogText.attributed(block.text ?? "")).font(Theme.display(21, weight: .bold, relativeTo: .title3)).foregroundStyle(Theme.text)
                        .accessibilityAddTraits(.isHeader)
                case .quote:
                    HStack(alignment: .top, spacing: 10) {
                        Rectangle().fill(Theme.primary).frame(width: 3)
                        Text(BlogText.attributed(block.text ?? "")).italic().font(Theme.body(16)).foregroundStyle(Theme.textSecondary)
                    }
                case .list:
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array((block.items ?? []).enumerated()), id: \.offset) { _, item in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("•").foregroundStyle(Theme.primary)
                                Text(BlogText.attributed(item)).font(Theme.body(16)).foregroundStyle(Theme.text)
                            }
                        }
                    }
                case .paragraph:
                    Text(BlogText.attributed(block.text ?? "")).font(Theme.body(16)).foregroundStyle(Theme.text)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }
}

/// Likes, comments, views in one line.
struct BlogCounters: View {
    let likes: Int
    let comments: Int
    let views: Int
    var liked = false

    var body: some View {
        HStack(spacing: 14) {
            Label("\(likes)", systemImage: liked ? "heart.fill" : "heart").foregroundStyle(liked ? Theme.primary : Theme.textSecondary)
            Label("\(comments)", systemImage: "bubble.left")
            Label("\(views)", systemImage: "eye")
        }
        .font(Theme.body(13)).foregroundStyle(Theme.textSecondary).labelStyle(.titleAndIcon)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Лайков \(likes), комментариев \(comments), просмотров \(views)")
    }
}

struct AuthorName: View {
    let author: PostAuthor

    var body: some View {
        if author.isCoach { CoachNameLabel(name: author.name, isPro: author.isPro) } else { Text(author.name) }
    }
}

// MARK: - a card of the feed

struct PostCardRow: View {
    let card: PostCard

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if card.coverFileId != nil {
                RemoteImageView(fileId: card.coverFileId).frame(width: 84, height: 84).clipShape(RoundedRectangle(cornerRadius: 10))
            }
            VStack(alignment: .leading, spacing: 5) {
                Text(card.sport).font(Theme.body(11, weight: .bold)).tracking(0.5).textCase(.uppercase).foregroundStyle(Theme.primary)
                Text(card.title).font(Theme.body(16, weight: .semibold, relativeTo: .headline)).foregroundStyle(Theme.text).lineLimit(2)
                if !card.excerpt.isEmpty {
                    Text(card.excerpt).font(Theme.body(14)).foregroundStyle(Theme.textSecondary).lineLimit(2)
                }
                HStack(spacing: 6) {
                    AuthorName(author: card.author).lineLimit(1)
                    Text("· \(BlogText.date(card.publishedAt))")
                }
                .font(Theme.body(12)).foregroundStyle(Theme.textTertiary)
                BlogCounters(likes: card.likesCount, comments: card.commentsCount, views: card.viewsCount, liked: card.likedByMe)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// The block of the home screen: the best article for the person's sport, and the way to all of them.
struct FeaturedPostCard: View {
    @Environment(AuthStore.self) private var auth
    @State private var card: PostCard?
    @State private var loaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let card {
                NavigationLink {
                    BlogPostView(postId: card.id)
                } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        Kicker("Статья · \(card.sport)")
                        if card.coverFileId != nil {
                            RemoteImageView(fileId: card.coverFileId).frame(height: 150).clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        Text(card.title).font(Theme.display(20, weight: .bold, relativeTo: .title3)).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                        if !card.excerpt.isEmpty {
                            Text(card.excerpt).font(Theme.body(14)).foregroundStyle(Theme.textSecondary).lineLimit(3).multilineTextAlignment(.leading)
                        }
                        HStack {
                            AuthorName(author: card.author).font(Theme.body(12)).foregroundStyle(Theme.textTertiary)
                            Spacer()
                            BlogCounters(likes: card.likesCount, comments: card.commentsCount, views: card.viewsCount, liked: card.likedByMe)
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("blog.featured")
                NavigationLink {
                    BlogFeedView()
                } label: {
                    HStack { Text("Все статьи").font(Theme.body(14, weight: .semibold)); Image(systemName: "chevron.right").font(.footnote) }
                        .foregroundStyle(Theme.primary)
                }
                .accessibilityIdentifier("blog.allPosts")
            }
        }
        .padding(card == nil ? 0 : 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(card == nil ? Color.clear : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous))
        .overlay {
            if card != nil { RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous).strokeBorder(Theme.border, lineWidth: 1) }
        }
        .task {
            // a failure here is nobody's business: the block just does not appear
            card = try? await auth.blog.featured()
            loaded = true
        }
    }
}

// MARK: - the feed

struct BlogFeedView: View {
    @Environment(AuthStore.self) private var auth

    private enum Tab: String, CaseIterable, Identifiable {
        case all = "Все", mine = "Мои", saved = "Сохранённые"
        var id: String { rawValue }
    }

    @State private var tab = Tab.all
    @State private var sport: String?
    @State private var sort = FeedSort.new
    @State private var sports: [String] = []
    @State private var items: [PostCard] = []
    @State private var total = 0
    @State private var mine: [MyPost] = []
    @State private var loading = true
    @State private var error: String?
    @State private var writing = false

    var body: some View {
        List {
            Section {
                Picker("Раздел", selection: $tab) {
                    ForEach(Tab.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented).accessibilityIdentifier("blog.tabs")
                .listRowBackground(Color.clear)
                if tab == .all { filters }
            }
            if let error { Section { Text(error).foregroundStyle(Theme.danger).font(.footnote) } }
            if tab == .mine { mineSection } else { feedSection }
        }
        .sagScreen()
        .navigationTitle("Статьи")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { writing = true } label: { Image(systemName: "square.and.pencil") }
                    .accessibilityLabel("Написать статью").accessibilityIdentifier("blog.write")
            }
        }
        .sheet(isPresented: $writing) { BlogEditorView(post: nil) { Task { await reload() } } }
        .task { await prepare() }
        .refreshable { await reload() }
        .onChange(of: tab) { _, _ in Task { await reload() } }
        .onChange(of: sport) { _, _ in Task { await reload() } }
        .onChange(of: sort) { _, _ in Task { await reload() } }
    }

    private var filters: some View {
        HStack {
            Menu {
                Button("Все виды спорта") { sport = nil }
                ForEach(sports, id: \.self) { name in Button(name) { sport = name } }
            } label: {
                Label(sport ?? "Все виды спорта", systemImage: "line.3.horizontal.decrease.circle")
            }
            .accessibilityIdentifier("blog.sport")
            Spacer()
            Picker("Порядок", selection: $sort) {
                ForEach(FeedSort.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.menu).accessibilityIdentifier("blog.sort")
        }
        .font(Theme.body(14)).listRowBackground(Color.clear)
    }

    @ViewBuilder private var feedSection: some View {
        Section {
            if loading && items.isEmpty {
                ProgressView().frame(maxWidth: .infinity)
            } else if items.isEmpty && error == nil {
                Text(tab == .saved ? "Сохранённых статей пока нет." : "Статей по этому виду спорта пока нет.").foregroundStyle(.secondary)
                    .accessibilityIdentifier("blog.empty")
            }
            ForEach(items) { card in
                NavigationLink {
                    BlogPostView(postId: card.id) { gone in remove(gone) }
                } label: {
                    PostCardRow(card: card)
                }
                .accessibilityIdentifier("blog.post")
                .onAppear { if card.id == items.last?.id { Task { await more() } } }
            }
        }
    }

    @ViewBuilder private var mineSection: some View {
        Section {
            if loading && mine.isEmpty {
                ProgressView().frame(maxWidth: .infinity)
            } else if mine.isEmpty && error == nil {
                Text("Вы пока ничего не писали. Нажмите на карандаш сверху, чтобы написать статью.").foregroundStyle(.secondary)
            }
            ForEach(mine) { post in
                NavigationLink {
                    BlogPostView(postId: post.id) { _ in Task { await reload() } }
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(post.title).font(Theme.body(16, weight: .semibold)).lineLimit(2)
                            Spacer()
                            Text(post.status.title).font(.caption.weight(.semibold)).padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Color(.secondarySystemBackground), in: Capsule())
                        }
                        if let reason = post.rejectReason, post.status == .rejected {
                            Text("Причина: \(reason)").font(.footnote).foregroundStyle(Theme.danger)
                        }
                        BlogCounters(likes: post.likesCount, comments: post.commentsCount, views: post.viewsCount)
                    }
                }
                .accessibilityIdentifier("blog.mine")
            }
        }
    }

    private func prepare() async {
        if sports.isEmpty { sports = (try? await auth.blog.sports()) ?? [] }
        await reload()
    }

    private func reload() async {
        loading = true
        error = nil
        defer { loading = false }
        do {
            switch tab {
            case .all:
                let page = try await auth.blog.feed(sport: sport, sort: sort)
                items = page.items
                total = page.total
            case .saved:
                let page = try await auth.blog.bookmarks()
                items = page.items
                total = page.total
            case .mine:
                mine = try await auth.blog.mine()
            }
        } catch {
            self.error = BlogText.message(error)
        }
    }

    private func more() async {
        guard tab != .mine, items.count < total, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let page = tab == .saved ? try await auth.blog.bookmarks(offset: items.count) : try await auth.blog.feed(sport: sport, sort: sort, offset: items.count)
            items += page.items.filter { new in !items.contains { $0.id == new.id } }
            total = page.total
        } catch {
            self.error = BlogText.message(error)
        }
    }

    /// The reader hid an article or its author (or the author deleted it): it leaves the list without another request.
    private func remove(_ gone: BlogGone) {
        switch gone {
        case .post(let id): items.removeAll { $0.id == id }
        case .author(let id): items.removeAll { $0.author.id == id }
        }
        Task { await reload() }
    }
}

enum BlogGone {
    case post(UUID)
    case author(UUID)
}

// MARK: - one article

struct BlogPostView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    let postId: UUID
    var onGone: ((BlogGone) -> Void)?

    @State private var load = LoadState<Post>.loading
    @State private var comments: [PostComment] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?
    @State private var reporting: ReportTarget?
    @State private var editing: Post?
    @State private var confirmDelete = false
    @State private var copied = false

    var body: some View {
        Group {
            switch load {
            case .loading: ProgressView("Загрузка…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось открыть статью", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await fetch() } }
                }
            case .loaded(let post): content(post)
            }
        }
        .sagScreen()
        .navigationTitle("Статья")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let post = load.value {
                ToolbarItem(placement: .topBarTrailing) { menu(post) }
            }
        }
        .reportSheet(item: $reporting)
        .sheet(item: $editing) { post in BlogEditorView(post: post) { Task { await fetch() } } }
        .confirmationDialog("Удалить статью?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) { Task { await deletePost() } }
        } message: {
            Text("Статью и комментарии под ней нельзя будет вернуть.")
        }
        .task { await fetch() }
    }

    // MARK: content

    private func content(_ post: Post) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if !post.imageIds.isEmpty { BlogCarousel(fileIds: post.imageIds) }
                Text(post.sport).font(Theme.body(12, weight: .bold)).tracking(0.6).textCase(.uppercase).foregroundStyle(Theme.primary)
                Text(post.title).font(Theme.display(26, weight: .heavy, relativeTo: .title2)).foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)
                authorRow(post)
                if post.isMine { statusNotice(post) }
                BlogBodyView(blocks: post.blocks)
                if let listing = post.listing { listingCard(listing, post: post) }
                if post.status == .published { actions(post) }
                if post.status == .published { commentsSection(post) }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func authorRow(_ post: Post) -> some View {
        let row = HStack(spacing: 10) {
            AvatarView(store: auth.profile, fileId: post.author.avatarFileId, initial: String(post.author.name.first ?? "?"), size: 36)
            VStack(alignment: .leading, spacing: 1) {
                AuthorName(author: post.author).font(Theme.body(14, weight: .semibold)).foregroundStyle(Theme.text)
                Text(BlogText.date(post.publishedAt)).font(Theme.body(12)).foregroundStyle(Theme.textTertiary)
            }
            Spacer()
            if post.author.profileOpen { Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.textTertiary) }
        }
        return Group {
            if post.author.profileOpen {
                NavigationLink { BlogAuthorView(authorId: post.author.id) } label: { row }.buttonStyle(.plain)
                    .accessibilityIdentifier("blog.author")
            } else {
                row
            }
        }
    }

    @ViewBuilder private func statusNotice(_ post: Post) -> some View {
        switch post.status {
        case .published: EmptyView()
        case .pending:
            AuthNotice(kind: .info, text: "Статья на проверке: её видите только вы. Мы напишем, когда проверим.")
        case .draft:
            AuthNotice(kind: .info, text: "Это черновик: его видите только вы. Откройте «Изменить», чтобы отправить статью на проверку.")
        case .rejected:
            AuthNotice(kind: .danger, text: "Статья отклонена: \(post.rejectReason ?? "причина не указана"). Исправьте её и отправьте снова.")
        case .removed:
            AuthNotice(kind: .danger, text: "Статья снята модератором\(post.rejectReason.map { ": \($0)" } ?? "").")
        }
    }

    private func listingCard(_ listing: PostListingCard, post: Post) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Занятия автора").font(Theme.body(12, weight: .bold)).tracking(0.5).textCase(.uppercase).foregroundStyle(Theme.textSecondary)
            HStack(spacing: 12) {
                if listing.photoFileId != nil {
                    RemoteImageView(fileId: listing.photoFileId).frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 8))
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(listing.title).font(Theme.body(15, weight: .semibold)).foregroundStyle(Theme.text)
                    if let price = listing.pricePerSession {
                        Text(Money.format(Decimal(price), currency: listing.currency)).font(Theme.body(13)).foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            NavigationLink {
                ListingDetailView(card: CoachListingCard(blogListing: listing, coachName: post.author.name, sport: post.sport), store: auth.coaches)
            } label: {
                Text("Записаться").frame(maxWidth: .infinity)
            }
            .buttonStyle(.sag)
            .accessibilityIdentifier("blog.book")
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func actions(_ post: Post) -> some View {
        HStack(spacing: 18) {
            Button { Task { await toggleLike(post) } } label: {
                Label("\(post.likesCount)", systemImage: post.likedByMe ? "heart.fill" : "heart")
                    .foregroundStyle(post.likedByMe ? Theme.primary : Theme.textSecondary)
            }
            .accessibilityLabel(post.likedByMe ? "Убрать лайк" : "Нравится")
            .accessibilityIdentifier("blog.like")
            Label("\(post.commentsCount)", systemImage: "bubble.left").foregroundStyle(Theme.textSecondary)
            Label("\(post.viewsCount)", systemImage: "eye").foregroundStyle(Theme.textSecondary)
            Spacer()
        }
        .font(Theme.body(15)).buttonStyle(.plain)
    }

    // MARK: the three dots

    private func menu(_ post: Post) -> some View {
        Menu {
            if post.isMine {
                Button("Изменить", systemImage: "pencil") { editing = post }.accessibilityIdentifier("blog.edit")
                Button("Удалить", systemImage: "trash", role: .destructive) { confirmDelete = true }.accessibilityIdentifier("blog.delete")
            } else {
                Button(post.bookmarkedByMe ? "Убрать из сохранённых" : "Сохранить", systemImage: post.bookmarkedByMe ? "bookmark.slash" : "bookmark") {
                    Task { await toggleBookmark(post) }
                }
            }
            if post.status == .published {
                Button("Скопировать ссылку", systemImage: "link") { copyLink(post) }
            }
            if !post.isMine {
                Button("Скрыть статью", systemImage: "eye.slash") { Task { await hide(post) } }
                Button("Скрыть автора", systemImage: "person.crop.circle.badge.minus") { Task { await muteAuthor(post) } }
                Button("Пожаловаться", systemImage: "flag") { reporting = .post(post.id) }.accessibilityIdentifier("blog.report")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel("Ещё").accessibilityIdentifier("blog.more")
    }

    private func copyLink(_ post: Post) {
        let site = auth.adminPanelURL.deletingLastPathComponent()
        UIPasteboard.general.string = site.appendingPathComponent("blog/\(post.id.uuidString.lowercased())").absoluteString
        copied = true
    }

    // MARK: comments

    private func commentsSection(_ post: Post) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Комментарии (\(comments.count))").font(Theme.display(17, relativeTo: .headline)).textCase(.uppercase).foregroundStyle(Theme.text)
            ForEach(comments) { comment in commentRow(comment) }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Ваш комментарий", text: $draft, axis: .vertical).lineLimit(1...5)
                    .textFieldStyle(.roundedBorder).accessibilityIdentifier("blog.commentField")
                Button { Task { await send(post) } } label: {
                    if sending { ProgressView() } else { Image(systemName: "paperplane.fill") }
                }
                .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("Отправить").accessibilityIdentifier("blog.commentSend")
            }
            Text("Телефоны, почту и ссылки в комментариях мы закрываем.").font(.caption).foregroundStyle(Theme.textTertiary)
            if let error { Text(error).font(.footnote).foregroundStyle(Theme.danger).accessibilityIdentifier("blog.error") }
        }
    }

    private func commentRow(_ comment: PostComment) -> some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(store: auth.profile, fileId: comment.author.avatarFileId, initial: String(comment.author.name.first ?? "?"), size: 30)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    AuthorName(author: comment.author).font(Theme.body(13, weight: .semibold)).foregroundStyle(Theme.text)
                    Text(comment.createdAt.formatted(.dateTime.day().month(.abbreviated).hour().minute().locale(Locale(identifier: "ru_RU"))))
                        .font(Theme.body(11)).foregroundStyle(Theme.textTertiary)
                    Spacer()
                    Menu {
                        if comment.isMine {
                            Button("Удалить", systemImage: "trash", role: .destructive) { Task { await delete(comment) } }
                        } else {
                            Button("Пожаловаться", systemImage: "flag") { reporting = .comment(comment.id) }
                        }
                    } label: {
                        Image(systemName: "ellipsis").foregroundStyle(Theme.textTertiary).frame(width: 28, height: 24)
                    }
                    .accessibilityLabel("Действия с комментарием")
                }
                Text(comment.body).font(Theme.body(14)).foregroundStyle(Theme.text)
            }
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: requests

    private func fetch() async {
        do {
            let post = try await auth.blog.read(postId)
            load = .loaded(post)
            if post.status == .published {
                comments = (try? await auth.blog.comments(postId)) ?? []
                if !post.isMine { await auth.blog.countView(postId) }
            }
        } catch {
            if load.value == nil { load = .failed(BlogText.message(error)) }
        }
    }

    private func update(_ change: (inout Post) -> Void) {
        if case .loaded(var post) = load {
            change(&post)
            load = .loaded(post)
        }
    }

    private func toggleLike(_ post: Post) async {
        do {
            let state = try await auth.blog.like(post.id, on: !post.likedByMe)
            update { $0.likedByMe = state.liked; $0.likesCount = state.likesCount }
        } catch {
            self.error = BlogText.message(error)
        }
    }

    private func toggleBookmark(_ post: Post) async {
        do {
            try await auth.blog.bookmark(post.id, on: !post.bookmarkedByMe)
            update { $0.bookmarkedByMe.toggle() }
        } catch {
            self.error = BlogText.message(error)
        }
    }

    private func hide(_ post: Post) async {
        do {
            try await auth.blog.hide(post.id, on: true)
            onGone?(.post(post.id))
            dismiss()
        } catch {
            self.error = BlogText.message(error)
        }
    }

    private func muteAuthor(_ post: Post) async {
        do {
            try await auth.blog.muteAuthor(post.author.id, on: true)
            onGone?(.author(post.author.id))
            dismiss()
        } catch {
            self.error = BlogText.message(error)
        }
    }

    private func deletePost() async {
        do {
            try await auth.blog.delete(postId)
            onGone?(.post(postId))
            dismiss()
        } catch {
            self.error = BlogText.message(error)
        }
    }

    private func send(_ post: Post) async {
        sending = true
        error = nil
        defer { sending = false }
        do {
            let comment = try await auth.blog.addComment(post.id, body: draft)
            comments.append(comment)
            draft = ""
            update { $0.commentsCount += 1 }
        } catch {
            self.error = BlogText.message(error)
        }
    }

    private func delete(_ comment: PostComment) async {
        do {
            try await auth.blog.deleteComment(comment.id)
            comments.removeAll { $0.id == comment.id }
            update { $0.commentsCount = max(0, $0.commentsCount - 1) }
        } catch {
            self.error = BlogText.message(error)
        }
    }
}

/// The photos of an article, one swipe apart.
struct BlogCarousel: View {
    @Environment(AuthStore.self) private var auth
    let fileIds: [UUID]
    @State private var index = 0

    var body: some View {
        TabView(selection: $index) {
            ForEach(Array(fileIds.enumerated()), id: \.offset) { offset, id in
                FullImage(fileId: id).tag(offset)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: fileIds.count > 1 ? .always : .never))
        .frame(height: 230)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel("Фото статьи, \(index + 1) из \(fileIds.count)")
    }

    private struct FullImage: View {
        @Environment(AuthStore.self) private var auth
        let fileId: UUID
        @State private var image: UIImage?

        var body: some View {
            ZStack {
                Rectangle().fill(Theme.primary.opacity(0.08))
                if let image { Image(uiImage: image).resizable().scaledToFill() } else { ProgressView() }
            }
            .clipped()
            .task(id: fileId) { image = await auth.profile.image(for: fileId, thumbnail: false) }
        }
    }
}

// MARK: - an author

struct BlogAuthorView: View {
    @Environment(AuthStore.self) private var auth
    let authorId: UUID

    @State private var load = LoadState<AuthorProfile>.loading
    @State private var posts: [PostCard] = []
    @State private var error: String?

    var body: some View {
        Group {
            switch load {
            case .loading: ProgressView("Загрузка…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось открыть автора", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await fetch() } }
                }
            case .loaded(let author): content(author)
            }
        }
        .sagScreen()
        .navigationTitle("Автор")
        .navigationBarTitleDisplayMode(.inline)
        .task { await fetch() }
    }

    private func content(_ author: AuthorProfile) -> some View {
        List {
            Section {
                HStack(spacing: 14) {
                    AvatarView(store: auth.profile, fileId: author.avatarFileId, initial: String(author.name.first ?? "?"), size: 64)
                    VStack(alignment: .leading, spacing: 3) {
                        if author.isCoach { CoachNameLabel(name: author.name, isPro: author.isPro).font(Theme.body(18, weight: .bold)) } else {
                            Text(author.name).font(Theme.body(18, weight: .bold))
                        }
                        Text([author.isCoach ? "Тренер" : "Игрок", author.sport, author.experienceYears.map { "\(Russian.years($0)) опыта" }]
                            .compactMap { $0 }.joined(separator: " · "))
                            .font(.subheadline).foregroundStyle(.secondary)
                        Text("Статей: \(author.postsCount)").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if author.isCoach {
                    NavigationLink { CoachProfileView(coachUserId: author.id) } label: { Label("Профиль тренера и объявления", systemImage: "person.text.rectangle") }
                        .accessibilityIdentifier("blogAuthor.coach")
                }
                if author.id != auth.user?.id {
                    Button(author.mutedByMe ? "Показывать статьи автора" : "Скрыть автора", systemImage: author.mutedByMe ? "eye" : "eye.slash") {
                        Task { await toggleMute(author) }
                    }
                    .accessibilityIdentifier("blogAuthor.mute")
                }
            }
            if let error { Section { Text(error).foregroundStyle(Theme.danger).font(.footnote) } }
            Section(sag: "Статьи") {
                if posts.isEmpty { Text("Пока нет опубликованных статей.").foregroundStyle(.secondary) }
                ForEach(posts) { card in
                    NavigationLink { BlogPostView(postId: card.id) } label: { PostCardRow(card: card) }
                }
            }
        }
    }

    private func fetch() async {
        do {
            let author = try await auth.blog.author(authorId)
            load = .loaded(author)
            if author.profileOpen { posts = try await auth.blog.feed(author: authorId, limit: 50).items }
        } catch {
            if load.value == nil { load = .failed(BlogText.message(error)) } else { self.error = BlogText.message(error) }
        }
    }

    private func toggleMute(_ author: AuthorProfile) async {
        do {
            try await auth.blog.muteAuthor(author.id, on: !author.mutedByMe)
            await fetch()
        } catch {
            self.error = BlogText.message(error)
        }
    }
}
