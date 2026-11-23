import XCTest

/// Статьи against the local server: the block on the home screen, the feed, an article with its offer card, a like and a comment, and the editor's checks.
/// Needs one published article (the seed of the local stand); the like is taken back, the comment stays (it is the local stand's).
final class BlogUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func openFeed() throws {
        try launchSignedIn()
        profileTab.tap()
        let row = element("profile.blog")
        scrollUntilVisible(row)
        row.tap()
        XCTAssertTrue(element("blog.tabs").waitForExistence(timeout: 10), "the feed did not open")
    }

    func testTheHomeScreenShowsTheBestArticle() throws {
        try launchSignedIn()
        XCTAssertTrue(element("blog.featured").waitForExistence(timeout: 15), "no article on the home screen")
        XCTAssertTrue(element("blog.allPosts").exists, "no way to the feed")
        element("blog.allPosts").tap()
        XCTAssertTrue(element("blog.tabs").waitForExistence(timeout: 10))
    }

    func testAnArticleCanBeOpenedLikedAndCommented() throws {
        try openFeed()
        let post = element("blog.post")
        XCTAssertTrue(post.waitForExistence(timeout: 15), "the feed is empty")
        post.tap()

        XCTAssertTrue(element("blog.like").waitForExistence(timeout: 10), "the article did not open")
        XCTAssertTrue(element("blog.book").waitForExistence(timeout: 5) || { self.scrollUntilVisible(self.element("blog.book")); return self.element("blog.book").exists }(),
                      "the offer card with «Записаться» is missing")
        element("blog.like").tap()
        let unlike = app.buttons["Убрать лайк"]
        XCTAssertTrue(unlike.waitForExistence(timeout: 10), "the like was not counted")
        unlike.tap()
        XCTAssertTrue(app.buttons["Нравится"].waitForExistence(timeout: 10), "the like was not taken back")

        let field = element("blog.commentField")
        scrollUntilVisible(field)
        field.tap()
        field.typeText("Спасибо, полезно! Пишите на test@example.com")
        element("blog.commentSend").tap()
        XCTAssertTrue(text(containing: "контакт скрыт").waitForExistence(timeout: 10), "the contact in the comment was not covered")
    }

    func testTheEditorChecksTheArticleBeforeSending() throws {
        try openFeed()
        element("blog.write").tap()
        let submit = element("blogEditor.submit")
        XCTAssertTrue(element("blogEditor.title").waitForExistence(timeout: 10), "the editor did not open")
        scrollUntilVisible(submit)
        submit.tap()
        XCTAssertTrue(element("blogEditor.problems").waitForExistence(timeout: 5), "an empty article must be refused with the reasons")
    }
}
