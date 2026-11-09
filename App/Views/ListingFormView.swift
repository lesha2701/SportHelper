import PhotosUI
import SportArenaKit
import SwiftUI

/// Making an offer, or changing one: what it says, its price and format, the photo and video, and the weekly schedule the free hours are cut from.
struct ListingFormView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    /// nil = a new offer.
    let listing: CoachListing?
    let onDone: () -> Void

    @State private var draft = ListingDraft()
    @State private var filled = false
    /// An existing offer's schedule is read first: saving without it would wipe it.
    @State private var scheduleLoaded = false
    @State private var scheduleProblem: String?
    @State private var photoItem: PhotosPickerItem?
    @State private var photo: Data?
    @State private var video: PickedVideo?
    @State private var videoProblem: String?
    @State private var saving = false
    @State private var error: String?
    /// Set once the offer exists on the server, so a second tap on «Сохранить» (after a failed photo) changes it instead of adding another.
    @State private var savedId: UUID?

    private var isNew: Bool { listing == nil }
    private var showsProblem: Bool { !draft.title.isEmpty || draft.isListed }

    var body: some View {
        NavigationStack {
            Form {
                aboutSection
                Section(sag: "Условия") {
                    FormField(title: "Цена за тренировку, ₽", hint: "Сколько стоит одно занятие: эту сумму игрок платит при записи.") {
                        TextField("Например, 2500", text: $draft.price).keyboardType(.decimalPad).accessibilityIdentifier("listingForm.price")
                    }
                    FormField(title: "Длительность, мин", hint: "Сколько длится одно занятие. По ней расписание режется на время для записи.") {
                        TextField("Например, 60", text: $draft.duration).keyboardType(.numberPad).accessibilityIdentifier("listingForm.duration")
                    }
                    HintedToggle(title: "Онлайн", hint: "Занятие по видеосвязи: игроку не нужно приезжать.", isOn: $draft.offersOnline)
                        .accessibilityIdentifier("listingForm.online")
                    HintedToggle(title: "Очно", hint: "Занятие лично: укажите город, где вы тренируете.", isOn: $draft.offersOffline)
                        .accessibilityIdentifier("listingForm.offline")
                    FormField(title: "Город", hint: "Нужен для очных тренировок: по нему игроки ищут тренера рядом.") {
                        TextField("Например, Москва", text: $draft.location).accessibilityIdentifier("listingForm.location")
                    }
                }
                mediaSections
                scheduleSection
                if let message = error ?? videoProblem ?? (showsProblem ? draft.problem() : nil) {
                    Section { Text(message).foregroundStyle(Theme.danger).accessibilityIdentifier("listingForm.error") }
                }
            }
            .sagScreen()
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(isNew ? "Новое объявление" : "Редактирование")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    // A number pad has no return key.
                    Spacer()
                    Button("Готово") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
                        .accessibilityIdentifier("keyboard.done")
                }
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить") { Task { await save() } }
                        .disabled(saving || draft.title.trimmingCharacters(in: .whitespaces).isEmpty)
                        .accessibilityIdentifier("listingForm.save")
                }
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    guard let data = try? await item.loadTransferable(type: Data.self), let jpeg = ImageEncoding.jpeg(from: data) else {
                        error = "Не удалось прочитать фото."
                        return
                    }
                    photo = jpeg
                }
            }
            .task { await fill() }
        }
        .interactiveDismissDisabled(saving)
    }

    private var aboutSection: some View {
        Section {
            FormField(title: "Название", hint: "Так объявление называется в каталоге, например «Индивидуальная тренировка по теннису».") {
                TextField("Название объявления", text: $draft.title).accessibilityIdentifier("listingForm.title")
            }
            FormField(title: "Описание", hint: "Чему вы научите, для кого занятие и что взять с собой.") {
                TextField("Расскажите о занятии", text: $draft.description, axis: .vertical).lineLimit(2...8)
                    .accessibilityIdentifier("listingForm.description")
            }
            HintedToggle(title: "Показывать в каталоге", hint: "Выключено: объявление видите только вы, записаться на него нельзя.", isOn: $draft.isListed)
                .accessibilityIdentifier("listingForm.listed")
        } footer: {
            Text("Игроки смогут найти объявление и записаться. Чтобы опубликовать, нужны формат, цена, длительность и расписание.")
        }
    }

    @ViewBuilder private var mediaSections: some View {
        Section(sag: "Фото") {
            if let photo, let image = UIImage(data: photo) {
                Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 180).clipShape(RoundedRectangle(cornerRadius: 10))
            } else if let id = listing?.photoFileId {
                RemoteImageView(fileId: id).frame(height: 140).clipShape(RoundedRectangle(cornerRadius: 10))
            }
            PhotosPicker(selection: $photoItem, matching: .images) {
                Label(photo != nil || listing?.photoFileId != nil ? "Выбрать другое фото" : "Выбрать фото", systemImage: "photo")
            }
            .accessibilityIdentifier("listingForm.photo")
        }
        Section {
            VideoAttachmentRow(
                video: $video, hasUploaded: listing?.videoFileId != nil, limitSeconds: VideoRules.maxExerciseSeconds,
                identifier: "listingForm.video", problem: $videoProblem
            )
        } header: {
            SagSectionHeader(title: "Видео")
        } footer: {
            Text("Не длиннее \(VideoRules.maxExerciseSeconds) секунд, до \(VideoRules.maxBytes / 1024 / 1024) МБ.")
        }
    }

    // MARK: schedule

    private var scheduleSection: some View {
        Section {
            if let scheduleProblem {
                Text("Не удалось загрузить расписание: \(scheduleProblem) Оно не изменится при сохранении. Закройте форму и откройте её снова.")
                    .font(.footnote).foregroundStyle(Theme.danger)
            } else if !scheduleLoaded {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Загрузка расписания…").foregroundStyle(.secondary)
                }
            } else {
                ForEach(draft.windows.indices, id: \.self) { index in
                    windowRow(index)
                }
                .onDelete { draft.windows.remove(atOffsets: $0) }
                Button {
                    draft.windows.append(AvailabilityWindow(weekday: 0, start: LocalTime(hour: 10, minute: 0)!, end: LocalTime(hour: 12, minute: 0)!))
                } label: {
                    Label("Добавить окно", systemImage: "plus.circle")
                }
                .accessibilityIdentifier("listingForm.addWindow")
            }
        } header: {
            SagSectionHeader(title: "Недельное расписание")
        } footer: {
            Text("Когда вы обычно свободны: из этого сервис нарежет время для записи.")
        }
    }

    @ViewBuilder private func windowRow(_ index: Int) -> some View {
        if draft.windows.indices.contains(index) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Picker("День недели", selection: weekday(index)) {
                        ForEach(0..<7, id: \.self) { Text(AvailabilityWindow.weekdayTitles[$0]).tag($0) }
                    }
                    Spacer()
                    // a button for it, not only the swipe: not everyone guesses the swipe
                    Button { draft.windows.remove(at: index) } label: { Image(systemName: "trash").foregroundStyle(Theme.danger) }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Удалить это окно")
                        .accessibilityIdentifier("listingForm.removeWindow")
                }
                HStack(spacing: 8) {
                    Text("С").foregroundStyle(.secondary)
                    DatePicker("С", selection: time(index, \.start), displayedComponents: .hourAndMinute).labelsHidden()
                    Text("до").foregroundStyle(.secondary)
                    DatePicker("До", selection: time(index, \.end), displayedComponents: .hourAndMinute).labelsHidden()
                    Spacer()
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("listingForm.window")
        }
    }

    private func weekday(_ index: Int) -> Binding<Int> {
        Binding(
            get: { draft.windows[safe: index]?.weekday ?? 0 },
            set: { day in
                guard draft.windows.indices.contains(index) else { return }
                draft.windows[index].weekday = day
            }
        )
    }

    private func time(_ index: Int, _ key: WritableKeyPath<AvailabilityWindow, LocalTime>) -> Binding<Date> {
        Binding(
            get: { (draft.windows[safe: index]?[keyPath: key] ?? LocalTime(hour: 10, minute: 0)!).onToday },
            set: { date in
                guard draft.windows.indices.contains(index) else { return }
                draft.windows[index][keyPath: key] = LocalTime(from: date)
            }
        )
    }

    // MARK: loading and saving

    private func fill() async {
        guard !filled else { return }
        filled = true
        guard let listing else {
            scheduleLoaded = true
            return
        }
        do {
            let windows = try await auth.listings.availability(listing.id)
            draft = ListingDraft(listing, windows: windows)
            scheduleLoaded = true
        } catch let failure as APIError {
            draft = ListingDraft(listing)
            scheduleProblem = failure.message
        } catch {
            draft = ListingDraft(listing)
            scheduleProblem = APIError.unknown.message
        }
    }

    private func save() async {
        if let problem = draft.problem() {
            error = problem
            return
        }
        saving = true
        error = nil
        defer { saving = false }
        let existing = savedId ?? listing?.id
        do {
            _ = try await auth.listings.save(draft, existing: existing, scheduleLoaded: scheduleLoaded, photo: photo, video: video?.data)
            onDone()
            dismiss()
        } catch let failure as ListingSaveFailure {
            if let id = failure.listingId, savedId == nil, listing == nil {
                savedId = id
                onDone()
            }
            // what was uploaded is not sent again
            if failure.step == .video { photo = nil } else if failure.step == .publishing { photo = nil; video = nil }
            error = Self.sentence(for: failure, wasNew: isNew)
        } catch {
            self.error = APIError.unknown.message
        }
    }

    /// What went wrong and what it affected, in the app's words.
    static func sentence(for failure: ListingSaveFailure, wasNew: Bool) -> String {
        let reason: String = switch failure.error.code {
        case "availability_required": "Сначала задайте расписание: без него нельзя опубликовать объявление."
        case "overlapping_availability": "Окна расписания в один день пересекаются."
        case "video_too_long": "Видео должно быть короче 1 минуты."
        case "unsupported_media_type": "Неподдерживаемый формат файла."
        case "coach_profile_required": "Сначала заполните профиль тренера: Профиль → Редактировать профиль."
        default: failure.error.message
        }
        if wasNew, failure.step != .listing, failure.listingId != nil {
            return "Объявление создано, но не удалось сохранить \(failure.step.noun): \(reason) Исправьте и нажмите «Сохранить» ещё раз."
        }
        return "Не удалось сохранить \(failure.step.noun): \(reason)"
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
