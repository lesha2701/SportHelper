import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!
private let one = "11111111-2222-4333-8444-555555555555"
private let two = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

private let authorJSON = """
{"id":"\(two)","name":"Иван Петров","is_coach":true,"is_pro":false,"profile_open":true,"avatar_file_id":null}
"""

private func cardJSON(id: String = one) -> String {
    """
    {"id":"\(id)","title":"Как подавать","sport":"Большой теннис","excerpt":"Коротко","cover_file_id":null,"images_count":0,"author":\(authorJSON),
     "likes_count":3,"comments_count":1,"views_count":10,"published_at":"2026-11-23T10:00:00Z","liked_by_me":false}
    """
}

private func postJSON(status: String = "published") -> String {
    """
    {"id":"\(one)","title":"Как подавать","sport":"Большой теннис","excerpt":"Коротко","cover_file_id":null,"images_count":1,"author":\(authorJSON),
     "likes_count":3,"comments_count":1,"views_count":10,"published_at":"2026-11-23T10:00:00Z","liked_by_me":true,"status":"\(status)",
     "blocks":[{"type":"paragraph","text":"Это **важно**"},{"type":"list","items":["раз","два"]}],"image_ids":["\(one)"],
     "listing":{"id":"\(two)","title":"Подача","price_per_session":2500.0,"currency":"RUB","photo_file_id":null,"coach_user_id":"\(two)"},
     "bookmarked_by_me":false,"is_mine":true,"reject_reason":null,"flags":[],"updated_at":"2026-11-23T10:00:00Z","sent_for_review":false}
    """
}

struct BlogMarkupTests {
    @Test func boldAndItalicBecomeRuns() {
        let runs = BlogMarkup.runs("Это **важно** и *нужно* всем")
        #expect(runs.map(\.text) == ["Это ", "важно", " и ", "нужно", " всем"])
        #expect(runs.map(\.bold) == [false, true, false, false, false])
        #expect(runs.map(\.italic) == [false, false, false, true, false])
    }

    @Test func anUnpairedMarkerStaysAsTyped() {
        #expect(BlogMarkup.runs("2 * 3 = 6").map(\.text) == ["2 * 3 = 6"])
        #expect(BlogMarkup.runs("<b>тег</b>").first?.text == "<b>тег</b>")
    }

    @Test func plainTextDropsTheMarkers() {
        #expect(BlogMarkup.plain("**a** *b*") == "a b")
    }

    @Test func wrappingASelectionPutsMarkersAround() {
        let result = BlogMarkup.wrap("hello world", location: 6, length: 5, marker: "**")
        #expect(result.text == "hello **world**")
        #expect(result.location == 8 && result.length == 5)
    }

    @Test func wrappingNothingPutsAPairWithTheCursorBetween() {
        let result = BlogMarkup.wrap("ab", location: 1, length: 0, marker: "*")
        #expect(result.text == "a**b")
        #expect(result.location == 2 && result.length == 0)
    }

    @Test func wrappingAWrappedSelectionUnwraps() {
        let result = BlogMarkup.wrap("a **bold** b", location: 2, length: 8, marker: "**")
        #expect(result.text == "a bold b")
        #expect(result.length == 4)
    }

    @Test func wrappingCountsInUTF16() {
        // a flag emoji is four UTF-16 units: the selection must not split it
        let result = BlogMarkup.wrap("🇷🇺 слово", location: 5, length: 5, marker: "*")
        #expect(result.text == "🇷🇺 *слово*")
    }
}

struct PostDraftTests {
    private func blocks(_ text: String) -> [PostBlock] { [PostBlock(type: .paragraph, text: text)] }

    @Test func aShortOrUntitledArticleHasProblems() {
        var draft = PostDraft(title: "Я", sport: "", blocks: blocks("коротко"))
        #expect(draft.problems.count == 3)
        draft.title = "Заголовок"
        draft.sport = "Футбол"
        draft.blocks = blocks(String(repeating: "слово ", count: 10))
        #expect(draft.isReady)
    }

    @Test func theLengthIsCountedWithoutMarkers() {
        let draft = PostDraft(title: "Заголовок", sport: "Футбол", blocks: blocks("**" + String(repeating: "а", count: 28) + "**"))
        #expect(draft.textLength == 28)
        #expect(!draft.isReady)
    }

    @Test func aListCountsItsItems() {
        let draft = PostDraft(blocks: [PostBlock(type: .list, items: ["раз", "два"])])
        #expect(draft.textLength == 6)
    }

    @Test func emptyBlocksAreNotSentAndNilFieldsAreLeftOut() throws {
        let draft = PostDraft(
            title: "Заголовок", sport: "Футбол", blocks: [PostBlock(type: .paragraph, text: "  "), PostBlock(type: .paragraph, text: "Текст")],
            imageIds: [UUID(uuidString: one)!], submit: true
        )
        let body = try #require(JSONSerialization.jsonObject(with: APIClient.encoder.encode(draft)) as? [String: Any])
        let sent = try #require(body["blocks"] as? [[String: Any]])
        #expect(sent.count == 1 && sent[0]["text"] as? String == "Текст" && sent[0]["items"] == nil && sent[0]["id"] == nil)
        #expect(body["image_ids"] as? [String] == [one])
        #expect(body["listing_id"] == nil)
        #expect(body["submit"] as? Bool == true)
    }

    @Test func aListIsEditedOneItemPerLine() {
        let block = PostBlock(type: .list, items: ["раз", "два"])
        #expect(block.editableText == "раз\nдва")
        #expect(PostBlock.make(.list, from: "раз\n\n  два \n").items == ["раз", "два"])
        #expect(PostBlock.make(.quote, from: "  цитата \n").text == "цитата")
    }
}

struct BlogDecodingTests {
    @Test func aPostDecodesWithItsBlocksAndOffer() throws {
        let post = try APIClient.decoder.decode(Post.self, from: Data(postJSON().utf8))
        #expect(post.status == .published && post.isMine && post.likedByMe)
        #expect(post.blocks.count == 2 && post.blocks[1].items == ["раз", "два"])
        #expect(post.listing?.title == "Подача" && post.listing?.pricePerSession == 2500)
        #expect(post.author.isCoach && post.author.profileOpen)
        #expect(PostDraft(editing: post).listingId == post.listing?.id)
    }

    @Test func aPageSaysWhetherThereIsMore() throws {
        let page = try APIClient.decoder.decode(
            PostPage.self, from: Data("{\"total\":3,\"limit\":1,\"offset\":0,\"items\":[\(cardJSON())]}".utf8)
        )
        #expect(page.hasMore)
    }

    @Test func theOfferBecomesACardForTheBookingScreens() throws {
        let post = try APIClient.decoder.decode(Post.self, from: Data(postJSON().utf8))
        let listing = try #require(post.listing)
        let card = CoachListingCard(blogListing: listing, coachName: post.author.name, sport: post.sport)
        #expect(card.id == listing.id && card.coachUserId == listing.coachUserId && card.coachFullName == "Иван Петров")
    }

    @Test func blogNotificationsOpenTheArticle() {
        let id = UUID(uuidString: one)!
        #expect(NotificationTarget(category: .postReview, entityId: id) == .blogPost(id))
        #expect(NotificationTarget(category: .postComment, entityId: id) == .blogPost(id))
    }

    @Test func complaintsKnowArticlesAndAdvertising() throws {
        #expect(ComplaintTarget.postComment.rawValue == "post_comment")
        #expect(ComplaintReason.advertising.title == "Реклама")
        #expect(ComplaintDraft(reason: .advertising).isReady)
    }
}

private final class Seen: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String] = []
    func add(_ item: String) { lock.withLock { items.append(item) } }
    var all: [String] { lock.withLock { items } }
}

struct BlogServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> BlogService {
        BlogService(client: APIClient(baseURL: base, session: MockServer.session(handler)))
    }

    @Test func theFeedAsksForTheSportSortAndPage() async throws {
        let service = make { request in
            let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
            #expect(request.url?.path == "/api/blog/posts")
            #expect(items.first { $0.name == "sport" }?.value == "Большой теннис")
            #expect(items.first { $0.name == "sort" }?.value == "popular")
            #expect(items.first { $0.name == "offset" }?.value == "20")
            return json("{\"total\":1,\"limit\":20,\"offset\":20,\"items\":[\(cardJSON())]}")
        }
        let page = try await service.feed(sport: "Большой теннис", sort: .popular, offset: 20)
        #expect(page.items.count == 1)
    }

    @Test func nothingFeaturedIsNil() async throws {
        let service = make { _ in json("null") }
        #expect(try await service.featured() == nil)
    }

    @Test func likingUsesPutAndUnlikingDelete() async throws {
        let service = make { request in
            #expect(request.url?.path == "/api/blog/posts/\(one)/like")
            return json(request.httpMethod == "PUT" ? "{\"liked\":true,\"likes_count\":4}" : "{\"liked\":false,\"likes_count\":3}")
        }
        let id = UUID(uuidString: one)!
        #expect(try await service.like(id, on: true).likesCount == 4)
        #expect(try await service.like(id, on: false).liked == false)
    }

    @Test func savingHidingAndMutingUseTheirPaths() async throws {
        let seen = Seen()
        let service = make { request in
            seen.add("\(request.httpMethod ?? "") \(request.url?.path ?? "")")
            return (status: 204, headers: [:], body: Data())
        }
        let id = UUID(uuidString: one)!
        try await service.bookmark(id, on: true)
        try await service.hide(id, on: true)
        try await service.muteAuthor(id, on: false)
        #expect(seen.all == ["PUT /api/blog/posts/\(one)/bookmark", "PUT /api/blog/posts/\(one)/hide", "DELETE /api/blog/authors/\(one)/mute"])
    }

    @Test func aCommentIsPostedAsText() async throws {
        let service = make { request in
            #expect(request.httpMethod == "POST" && request.url?.path == "/api/blog/posts/\(one)/comments")
            #expect(request.bodyJSON?["body"] as? String == "Отлично")
            return json(
                "{\"id\":\"\(two)\",\"post_id\":\"\(one)\",\"author\":\(authorJSON),\"body\":\"Отлично\",\"contact_hidden\":false,\"created_at\":\"2026-11-23T10:00:00Z\",\"is_mine\":true}",
                status: 201
            )
        }
        #expect(try await service.addComment(UUID(uuidString: one)!, body: "Отлично").isMine)
    }

    @Test func savingAnArticleSendsTheDraft() async throws {
        let service = make { request in
            #expect(request.httpMethod == "POST" && request.url?.path == "/api/blog/posts")
            #expect(request.bodyJSON?["submit"] as? Bool == true)
            return json(postJSON(status: "pending"), status: 201)
        }
        var draft = PostDraft(title: "Как подавать", sport: "Большой теннис", blocks: [PostBlock(type: .paragraph, text: "Текст")])
        draft.submit = true
        #expect(try await service.create(draft).status == .pending)
    }

    @Test func aRefusedArticleBringsTheServersWords() async throws {
        let service = make { _ in
            json("{\"error\":{\"code\":\"article_rejected\",\"message\":\"В статье нельзя указывать телефоны.\"}}", status: 422)
        }
        do {
            _ = try await service.create(PostDraft(title: "Как подавать", sport: "Футбол"))
            Issue.record("must fail")
        } catch let error as APIError {
            #expect(error.message.contains("телефоны"))
        }
    }

    @Test func aPhotoIsUploadedAndItsFileNumberReturned() async throws {
        let service = make { request in
            #expect(request.url?.path == "/api/blog/images")
            return json("{\"file_id\":\"\(one)\"}", status: 201)
        }
        #expect(try await service.uploadImage(Data([1, 2, 3])) == UUID(uuidString: one))
    }
}
