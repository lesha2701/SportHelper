import PhotosUI
import SportArenaKit
import SwiftUI
import UIKit

/// A text field that knows the article's two markers: the buttons above the keyboard wrap the selection in `**` or `*`.
@MainActor
final class MarkupController {
    weak var active: UITextView?

    func wrap(_ marker: String) {
        guard let view = active else { return }
        let range = view.selectedRange
        let result = BlogMarkup.wrap(view.text, location: range.location, length: range.length, marker: marker)
        view.text = result.text
        view.selectedRange = NSRange(location: result.location, length: result.length)
        view.delegate?.textViewDidChange?(view)
    }
}

struct MarkupTextView: UIViewRepresentable {
    @Binding var text: String
    let controller: MarkupController
    var minHeight: CGFloat = 44

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.font = UIFont.preferredFont(forTextStyle: .body)
        view.backgroundColor = .clear
        view.isScrollEnabled = false
        view.textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
        view.textContainer.lineFragmentPadding = 0
        view.text = text
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text { view.text = text }
        context.coordinator.parent = self
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? 300
        let fitted = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: max(minHeight, fitted.height))
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: MarkupTextView

        init(_ parent: MarkupTextView) { self.parent = parent }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            textView.invalidateIntrinsicContentSize()
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            MainActor.assumeIsolated { parent.controller.active = textView }
        }
    }
}

/// One block as the editor holds it: the kind and the text (a list is one item per line).
private struct EditableBlock: Identifiable, Equatable {
    let id = UUID()
    var type: BlockType
    var text: String
}

/// Write or change an article: a title, a sport, blocks of text with bold and italic, up to three photos, for a trainer one of their offers.
struct BlogEditorView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    let post: Post?
    let onSaved: () -> Void

    @State private var title = ""
    @State private var sport = ""
    @State private var blocks: [EditableBlock] = [EditableBlock(type: .paragraph, text: "")]
    @State private var imageIds: [UUID] = []
    @State private var listingId: UUID?
    @State private var sports: [String] = []
    @State private var listings: [CoachListing] = []
    @State private var settings: BlogSettings?
    @State private var pickedPhotos: [PhotosPickerItem] = []
    @State private var uploading = false
    @State private var saving = false
    @State private var problems: [String] = []
    @State private var result: Post?
    @State private var previewing = false
    @State private var controller = MarkupController()

    private var draft: PostDraft {
        PostDraft(
            title: title, sport: sport, blocks: blocks.map { PostBlock.make($0.type, from: $0.text) }, imageIds: imageIds, listingId: listingId
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                basics
                bodySection
                photosSection
                if auth.user?.isCoach == true { listingSection }
                if let settings, !settings.isCoach { profileSection(settings) }
                if !problems.isEmpty {
                    Section {
                        ForEach(problems, id: \.self) { Text($0).font(.footnote).foregroundStyle(Theme.danger) }
                    }
                    .accessibilityIdentifier("blogEditor.problems")
                }
                actions
            }
            .sagScreen()
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(post == nil ? "Новая статья" : "Изменить статью")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() }.disabled(saving) }
                ToolbarItemGroup(placement: .keyboard) {
                    Button { controller.wrap("**") } label: { Image(systemName: "bold") }.accessibilityLabel("Жирный")
                    Button { controller.wrap("*") } label: { Image(systemName: "italic") }.accessibilityLabel("Курсив")
                    Spacer()
                    Button("Готово") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
                }
            }
            .sheet(isPresented: $previewing) { preview }
            .alert(resultTitle, isPresented: Binding(get: { result != nil }, set: { if !$0 { result = nil } })) {
                Button("Хорошо") { onSaved(); dismiss() }
            } message: {
                Text(resultMessage)
            }
            .task { await prepare() }
            .onChange(of: pickedPhotos) { _, items in Task { await upload(items) } }
        }
        .interactiveDismissDisabled(saving)
    }

    // MARK: sections

    private var basics: some View {
        Section(sag: "Заголовок и вид спорта") {
            TextField("Заголовок", text: $title).accessibilityIdentifier("blogEditor.title")
            Picker("Вид спорта", selection: $sport) {
                Text("Выберите").tag("")
                ForEach(sports, id: \.self) { Text($0).tag($0) }
            }
            .accessibilityIdentifier("blogEditor.sport")
        }
    }

    private var bodySection: some View {
        Section {
            ForEach($blocks) { $block in
                VStack(alignment: .leading, spacing: 4) {
                    Menu {
                        ForEach(BlockType.allCases, id: \.self) { type in Button(type.title) { block.type = type } }
                        Button("Убрать блок", role: .destructive) { blocks.removeAll { $0.id == block.id } }
                    } label: {
                        Label(block.type.title, systemImage: "chevron.up.chevron.down").font(.caption.weight(.semibold))
                    }
                    MarkupTextView(text: $block.text, controller: controller)
                        .accessibilityLabel(block.type.title).accessibilityIdentifier("blogEditor.block")
                    if block.type == .list { Text("Каждый пункт с новой строки.").font(.caption).foregroundStyle(.secondary) }
                }
            }
            Menu {
                ForEach(BlockType.allCases, id: \.self) { type in Button(type.title) { blocks.append(EditableBlock(type: type, text: "")) } }
            } label: {
                Label("Добавить блок", systemImage: "plus.circle")
            }
            .accessibilityIdentifier("blogEditor.addBlock")
        } header: {
            SagSectionHeader(title: "Текст")
        } footer: {
            Text("Выделите слово и нажмите «Ж» или «К» над клавиатурой: **жирный**, *курсив*. Знаков: \(draft.textLength) (нужно от 30 до 10 000). Телефоны, почту, ссылки и ники указывать нельзя.")
        }
    }

    private var photosSection: some View {
        Section(sag: "Фото (до \(PostDraft.maxImages))") {
            if !imageIds.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(imageIds, id: \.self) { id in
                            RemoteImageView(fileId: id).frame(width: 96, height: 96).clipShape(RoundedRectangle(cornerRadius: 10))
                                .overlay(alignment: .topTrailing) {
                                    Button { imageIds.removeAll { $0 == id } } label: {
                                        Image(systemName: "xmark.circle.fill").foregroundStyle(.white, .black.opacity(0.6)).font(.title3)
                                    }
                                    .padding(4).accessibilityLabel("Убрать фото")
                                }
                        }
                    }
                }
            }
            if imageIds.count < PostDraft.maxImages {
                PhotosPicker(selection: $pickedPhotos, maxSelectionCount: PostDraft.maxImages - imageIds.count, matching: .images) {
                    Label(uploading ? "Загружаем…" : "Добавить фото", systemImage: "photo.on.rectangle")
                }
                .disabled(uploading).accessibilityIdentifier("blogEditor.photos")
            }
        }
    }

    private var listingSection: some View {
        Section {
            Picker("Объявление", selection: $listingId) {
                Text("Без объявления").tag(UUID?.none)
                ForEach(listings.filter(\.isListed)) { Text($0.title).tag(UUID?.some($0.id)) }
            }
            .accessibilityIdentifier("blogEditor.listing")
        } header: {
            SagSectionHeader(title: "Запись на занятия")
        } footer: {
            Text("Под статьёй появится карточка этого объявления с кнопкой «Записаться». Так люди записываются на платформе, а не по контактам в тексте.")
        }
    }

    private func profileSection(_ settings: BlogSettings) -> some View {
        Section {
            Toggle("Показывать мой профиль в статьях", isOn: Binding(
                get: { settings.showProfileInPosts },
                set: { value in Task { await setShowProfile(value) } }
            ))
            .tint(Theme.primary).accessibilityIdentifier("blogEditor.showProfile")
        } footer: {
            Text("Выключено — под статьёй видно только ваше имя. Включено — читатели могут открыть ваш профиль и другие ваши статьи.")
        }
    }

    private var actions: some View {
        Section {
            Button("Предпросмотр") { previewing = true }.accessibilityIdentifier("blogEditor.preview")
            Button(saving ? "Сохраняем…" : "Сохранить черновик") { Task { await save(submit: false) } }
                .disabled(saving || uploading).accessibilityIdentifier("blogEditor.draft")
            Button(saving ? "Отправляем…" : "Отправить на проверку") { Task { await save(submit: true) } }
                .buttonStyle(.sag).disabled(saving || uploading).accessibilityIdentifier("blogEditor.submit")
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
        } footer: {
            Text("Сначала статью проверит система, потом модератор: до этого её видите только вы. Если вы пишете без замечаний, модерация может стать мгновенной.")
        }
    }

    private var preview: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if !imageIds.isEmpty { BlogCarousel(fileIds: imageIds) }
                    Text(title.isEmpty ? "Без заголовка" : title).font(Theme.display(26, weight: .heavy, relativeTo: .title2))
                    BlogBodyView(blocks: draft.blocks.filter { !$0.isEmpty })
                }
                .padding(16)
            }
            .navigationTitle("Предпросмотр").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Закрыть") { previewing = false } } }
        }
    }

    // MARK: result

    private var resultTitle: String {
        switch result?.status {
        case .published: "Статья опубликована"
        case .pending: "Статья отправлена на проверку"
        default: "Черновик сохранён"
        }
    }

    private var resultMessage: String {
        switch result?.status {
        case .published: "Теперь её видят все."
        case .pending: "Мы напишем вам, когда проверим. До этого статью видите только вы."
        default: "Он виден только вам. Отправьте его на проверку, когда будет готов."
        }
    }

    // MARK: requests

    private func prepare() async {
        if let post, title.isEmpty {
            let existing = PostDraft(editing: post)
            title = existing.title
            sport = existing.sport
            blocks = existing.blocks.isEmpty ? blocks : existing.blocks.map { EditableBlock(type: $0.type, text: $0.editableText) }
            imageIds = existing.imageIds
            listingId = existing.listingId
        }
        sports = (try? await auth.blog.sports()) ?? []
        settings = try? await auth.blog.settings()
        if auth.user?.isCoach == true { listings = (try? await auth.listings.mine()) ?? [] }
    }

    private func upload(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        uploading = true
        problems = []
        defer { uploading = false; pickedPhotos = [] }
        for item in items where imageIds.count < PostDraft.maxImages {
            guard let data = try? await item.loadTransferable(type: Data.self), let jpeg = ImageEncoding.jpeg(from: data) else {
                problems = ["Не удалось прочитать фото."]
                continue
            }
            do {
                imageIds.append(try await auth.blog.uploadImage(jpeg))
            } catch {
                problems = [BlogText.message(error)]
            }
        }
    }

    private func setShowProfile(_ value: Bool) async {
        do { settings = try await auth.blog.setShowProfile(value) } catch { problems = [BlogText.message(error)] }
    }

    private func save(submit: Bool) async {
        var toSend = draft
        toSend.submit = submit
        if submit {
            problems = toSend.problems
            if !problems.isEmpty { return }
        } else if toSend.title.trimmingCharacters(in: .whitespaces).count < 3 || toSend.sport.isEmpty {
            problems = ["Для черновика нужны заголовок и вид спорта."]
            return
        }
        problems = []
        saving = true
        defer { saving = false }
        do {
            if let post { result = try await auth.blog.update(post.id, toSend) } else { result = try await auth.blog.create(toSend) }
        } catch {
            problems = [BlogText.message(error)]
        }
    }
}
