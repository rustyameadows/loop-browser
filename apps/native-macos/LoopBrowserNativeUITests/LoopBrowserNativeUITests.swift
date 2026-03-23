import CryptoKit
import XCTest

final class LoopBrowserNativeUITests: XCTestCase {
  private struct UITestWorkspaceState: Decodable {
    struct Viewport: Decodable {
      struct Frame: Decodable {
        var x: Double
        var y: Double
        var width: Double
        var height: Double
      }

      var id: UUID
      var frame: Frame
    }

    var canvasScale: Double
    var canvasOffsetX: Double
    var canvasOffsetY: Double
    var viewports: [Viewport]
  }

  private var app: XCUIApplication!
  private var testAppSupportDirectory: URL!

  override func setUpWithError() throws {
    continueAfterFailure = false
    testAppSupportDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent("loop-browser-native-uitests-\(UUID().uuidString)", isDirectory: true)

    app = XCUIApplication()
    app.launchEnvironment["LOOP_BROWSER_TEST_PROJECT_ROOT"] = fixtureProjectRoot.path
    app.launchEnvironment["LOOP_BROWSER_TEST_START_URL"] = primaryFixtureURL
    app.launchEnvironment["LOOP_BROWSER_TEST_SECONDARY_URL"] = secondaryFixtureURL
    app.launchEnvironment["LOOP_BROWSER_TEST_VIEWPORT_WIDTH"] = "960"
    app.launchEnvironment["LOOP_BROWSER_TEST_VIEWPORT_HEIGHT"] = "640"
    app.launchEnvironment["LOOP_BROWSER_TEST_DISABLE_RESTORE"] = "1"
    app.launchEnvironment["LOOP_BROWSER_TEST_DISABLE_MCP"] = "1"
    app.launchEnvironment["LOOP_BROWSER_APP_SUPPORT_DIR"] = testAppSupportDirectory.path
    app.launch()

    waitForViewportChrome(index: 0)
    waitForViewportChrome(index: 1, includeRightResizeHandle: true)
    _ = requireOtherElement("canvas-interaction-surface", timeout: 10)
    _ = waitForWorkspaceState(timeout: 10) { state in
      state.viewports.count == 2
    }
    XCTAssertTrue(requireWebView(labeled: "Primary View", timeout: 10).exists)
    XCTAssertTrue(requireWebView(labeled: "Secondary View", timeout: 10).exists)
  }

  func testViewportInputFocusCanReturnToCanvasAndMoveViewport() {
    focusViewportInput(index: 0, text: "Loop Native")

    let beforePan = try! XCTUnwrap(workspaceState())
    let afterPan = dragCanvas(by: CGVector(dx: 92, dy: 68), minimumDistance: 40)
    XCTAssertGreaterThan(
      hypot(
        afterPan.canvasOffsetX - beforePan.canvasOffsetX,
        afterPan.canvasOffsetY - beforePan.canvasOffsetY
      ),
      40
    )
    assertFixtureFocusStatus(index: 0, status: "blurred")

    let beforeMove = viewportCardFrame(index: 0)
    let afterMove = dragViewportHeader(index: 0, delta: CGVector(dx: 156, dy: 96))
    XCTAssertGreaterThan(abs(afterMove.minX - beforeMove.minX), 110)
    XCTAssertGreaterThan(abs(afterMove.minY - beforeMove.minY), 70)
    XCTAssertEqual(requireOtherElement("viewport-card-0").value as? String, "selected")
  }

  func testCompositeCanvasWorkflowRemainsInteractive() {
    let baselineState = try! XCTUnwrap(workspaceState())
    let baselineViewportA = viewportCardFrame(index: 0)
    let baselineViewportB = viewportCardFrame(index: 1)

    focusViewportInput(index: 0, text: "Focus trap")

    _ = dragCanvas(by: CGVector(dx: 84, dy: 62), minimumDistance: 36)

    let zoomedOutState = zoomOut(times: 6)
    XCTAssertLessThan(zoomedOutState.canvasScale, baselineState.canvasScale * 0.65)

    _ = dragCanvas(by: CGVector(dx: -132, dy: 94), minimumDistance: 44)

    let zoomedInState = zoomIn(times: 4)
    XCTAssertGreaterThan(zoomedInState.canvasScale, zoomedOutState.canvasScale * 1.55)

    _ = dragCanvas(by: CGVector(dx: 118, dy: -74), minimumDistance: 44)

    let movedViewportA = dragViewportHeader(index: 0, delta: CGVector(dx: 172, dy: 118))
    XCTAssertGreaterThan(abs(movedViewportA.minX - baselineViewportA.minX), 130)
    XCTAssertGreaterThan(abs(movedViewportA.minY - baselineViewportA.minY), 90)
    XCTAssertEqual(requireOtherElement("viewport-card-0").value as? String, "selected")

    let resetState = resetCanvasZoom()
    let resetViewportA = viewportCardFrame(index: 0)
    XCTAssertEqual(resetState.canvasScale, 1, accuracy: 0.03)
    XCTAssertEqual(resetViewportA.width, resetState.viewports[0].frame.width, accuracy: 16)
    XCTAssertEqual(resetViewportA.height, resetState.viewports[0].frame.height, accuracy: 16)
    XCTAssertGreaterThan(abs(resetViewportA.minX - baselineViewportA.minX), 120)

    _ = dragCanvas(by: CGVector(dx: -96, dy: 88), minimumDistance: 40)

    let resizedViewportB = resizeViewportRight(index: 1, deltaX: 148)
    XCTAssertGreaterThan(resizedViewportB.width - baselineViewportB.width, 110)
    XCTAssertLessThan(abs(resizedViewportB.height - baselineViewportB.height), 10)
    XCTAssertEqual(requireOtherElement("viewport-card-1").value as? String, "selected")

    let resizedState = waitForWorkspaceState(timeout: 10) { state in
      state.viewports[1].frame.width - baselineState.viewports[1].frame.width > 110
    }
    XCTAssertGreaterThan(
      resizedState.viewports[1].frame.width - baselineState.viewports[1].frame.width,
      110
    )

    let deeplyZoomedOutState = zoomOut(times: 10)
    XCTAssertLessThan(deeplyZoomedOutState.canvasScale, 0.45)

    _ = dragCanvas(by: CGVector(dx: 144, dy: 108), minimumDistance: 52)

    let movedViewportBAgain = dragViewportHeader(index: 1, delta: CGVector(dx: -136, dy: 84))
    XCTAssertGreaterThan(abs(movedViewportBAgain.minX - resizedViewportB.minX), 90)
    XCTAssertGreaterThan(abs(movedViewportBAgain.minY - resizedViewportB.minY), 60)
    XCTAssertEqual(requireOtherElement("viewport-card-1").value as? String, "selected")

    let finalState = waitForWorkspaceState(timeout: 10) { state in
      abs(state.viewports[1].frame.x - resizedState.viewports[1].frame.x) > 90
        && abs(state.viewports[1].frame.y - resizedState.viewports[1].frame.y) > 60
    }
    XCTAssertGreaterThan(abs(finalState.viewports[1].frame.x - resizedState.viewports[1].frame.x), 90)
    XCTAssertGreaterThan(abs(finalState.viewports[1].frame.y - resizedState.viewports[1].frame.y), 60)

    clickIncrementButton(index: 0, expectedCount: 1)
    dragFixtureCard(index: 0)
  }

  private var nativeMacOSRoot: URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  private var fixtureProjectRoot: URL {
    nativeMacOSRoot.appendingPathComponent("TestFixtures/interactive-project", isDirectory: true)
  }

  private var primaryFixtureURL: String {
    fixtureURL(
      title: "Primary View",
      subtitle: "Primary composite workflow viewport.",
      variant: "primary"
    )
  }

  private var secondaryFixtureURL: String {
    fixtureURL(
      title: "Secondary View",
      subtitle: "Secondary composite workflow viewport.",
      variant: "secondary"
    )
  }

  private func fixtureURL(title: String, subtitle: String, variant: String) -> String {
    var components = URLComponents(
      url: fixtureProjectRoot.appendingPathComponent("interactive-fixture.html"),
      resolvingAgainstBaseURL: false
    )!
    components.queryItems = [
      URLQueryItem(name: "title", value: title),
      URLQueryItem(name: "subtitle", value: subtitle),
      URLQueryItem(name: "variant", value: variant),
    ]
    return components.url!.absoluteString
  }

  private func focusViewportInput(index: Int, text: String) {
    let webView = requireWebView(labeled: viewportLabel(for: index))
    let textField = webView.textFields["Fixture Input"].firstMatch
    XCTAssertTrue(textField.waitForExistence(timeout: 5))
    textField.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
    app.typeText(text)

    let typedValue = textField.value as? String ?? ""
    XCTAssertTrue(typedValue.contains(text))
    assertFixtureFocusStatus(index: index, status: "focused")
    assertFixtureLastAction(index: index, action: "input-focus")
  }

  private func clickIncrementButton(index: Int, expectedCount: Int) {
    let webView = requireWebView(labeled: viewportLabel(for: index))
    let incrementButton = webView.buttons["Increment Counter"].firstMatch
    XCTAssertTrue(incrementButton.waitForExistence(timeout: 5))
    incrementButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
    XCTAssertTrue(webView.staticTexts["Counter: \(expectedCount)"].waitForExistence(timeout: 5))
    assertFixtureLastAction(index: index, action: "counter-click")
  }

  private func dragFixtureCard(index: Int) {
    let webView = requireWebView(labeled: viewportLabel(for: index))
    let dragCard = webView.otherElements["Drag Sample Card"].firstMatch
    XCTAssertTrue(dragCard.waitForExistence(timeout: 5))
    let start = dragCard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    let end = start.withOffset(CGVector(dx: 84, dy: 58))
    start.press(forDuration: 0.05, thenDragTo: end)
    assertFixtureLastAction(index: index, action: "card-drag")
  }

  @discardableResult
  private func dragCanvas(
    by translation: CGVector,
    minimumDistance: Double
  ) -> UITestWorkspaceState {
    let before = try! XCTUnwrap(workspaceState())
    let excludedFrames = (0..<before.viewports.count).map { viewportCardFrame(index: $0) }
    let startPoint = safeEmptyCanvasScreenPoint(excluding: excludedFrames)
    let start = surfaceCoordinate(forScreenPoint: startPoint)
    let end = surfaceCoordinate(
      forScreenPoint: CGPoint(x: startPoint.x + translation.dx, y: startPoint.y + translation.dy)
    )

    start.press(forDuration: 0.05, thenDragTo: end)

    return waitForWorkspaceState(timeout: 10) { state in
      hypot(
        state.canvasOffsetX - before.canvasOffsetX,
        state.canvasOffsetY - before.canvasOffsetY
      ) > minimumDistance
    }
  }

  @discardableResult
  private func dragViewportHeader(index: Int, delta: CGVector) -> CGRect {
    let before = viewportCardFrame(index: index)
    let header = requireOtherElement("viewport-header-\(index)")
    let start = header.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    let end = start.withOffset(delta)
    start.press(forDuration: 0.05, thenDragTo: end)

    return waitForOtherElementFrame(identifier: "viewport-card-\(index)", timeout: 10) { frame in
      abs(frame.minX - before.minX) > 70
        && abs(frame.minY - before.minY) > 50
    }
  }

  @discardableResult
  private func resizeViewportRight(index: Int, deltaX: CGFloat) -> CGRect {
    let before = viewportCardFrame(index: index)
    let handle = requireOtherElement("viewport-resize-right-\(index)")
    let start = handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    let end = start.withOffset(CGVector(dx: deltaX, dy: 0))
    start.press(forDuration: 0.05, thenDragTo: end)

    return waitForOtherElementFrame(identifier: "viewport-card-\(index)", timeout: 10) { frame in
      frame.width - before.width > 90
    }
  }

  private func zoomOut(times: Int) -> UITestWorkspaceState {
    let button = requireButton("canvas-zoom-out")
    var lastState = try! XCTUnwrap(workspaceState())

    for _ in 0..<times {
      let baseline = lastState
      button.click()
      lastState = waitForWorkspaceState(timeout: 10) { state in
        state.canvasScale < baseline.canvasScale - 0.01
      }
    }

    return lastState
  }

  private func zoomIn(times: Int) -> UITestWorkspaceState {
    let button = requireButton("canvas-zoom-in")
    var lastState = try! XCTUnwrap(workspaceState())

    for _ in 0..<times {
      let baseline = lastState
      button.click()
      lastState = waitForWorkspaceState(timeout: 10) { state in
        state.canvasScale > baseline.canvasScale + 0.01
      }
    }

    return lastState
  }

  private func resetCanvasZoom() -> UITestWorkspaceState {
    requireButton("canvas-zoom-reset").click()
    return waitForWorkspaceState(timeout: 10) { state in
      abs(state.canvasScale - 1) < 0.03
    }
  }

  private func viewportLabel(for index: Int) -> String {
    index == 0 ? "Primary View" : "Secondary View"
  }

  private func safeEmptyCanvasScreenPoint(excluding frames: [CGRect]) -> CGPoint {
    let surfaceFrame = requireOtherElement("canvas-interaction-surface").frame
    let candidatePoints = [
      CGPoint(x: surfaceFrame.minX + 72, y: surfaceFrame.minY + 120),
      CGPoint(x: surfaceFrame.maxX - 72, y: surfaceFrame.minY + 120),
      CGPoint(x: surfaceFrame.minX + 72, y: surfaceFrame.maxY - 120),
      CGPoint(x: surfaceFrame.maxX - 72, y: surfaceFrame.maxY - 120),
      CGPoint(x: surfaceFrame.midX, y: surfaceFrame.minY + 120),
      CGPoint(x: surfaceFrame.midX, y: surfaceFrame.maxY - 120),
      CGPoint(x: surfaceFrame.minX + 120, y: surfaceFrame.midY),
      CGPoint(x: surfaceFrame.maxX - 120, y: surfaceFrame.midY),
    ]
    let expandedFrames = frames.map { $0.insetBy(dx: -20, dy: -20) }
    let safeSurfaceFrame = surfaceFrame.insetBy(dx: 40, dy: 40)

    if let point = candidatePoints.first(where: { point in
      safeSurfaceFrame.contains(point) && !expandedFrames.contains(where: { $0.contains(point) })
    }) {
      return point
    }

    XCTFail("Could not find an empty canvas point outside current viewport frames")
    return CGPoint(x: surfaceFrame.minX + 72, y: surfaceFrame.minY + 120)
  }

  private func waitForNonExistence(of element: XCUIElement, timeout: TimeInterval = 5) -> Bool {
    let predicate = NSPredicate(format: "exists == false")
    let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
    return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
  }

  private func workspaceState() -> UITestWorkspaceState? {
    guard
      let data = try? Data(contentsOf: workspaceStateFileURL()),
      let state = try? JSONDecoder().decode(UITestWorkspaceState.self, from: data)
    else {
      return nil
    }
    return state
  }

  private func waitForWorkspaceState(
    timeout: TimeInterval = 5,
    condition: (UITestWorkspaceState) -> Bool
  ) -> UITestWorkspaceState {
    let deadline = Date().addingTimeInterval(timeout)
    var lastState: UITestWorkspaceState?
    while Date() < deadline {
      if let state = workspaceState() {
        lastState = state
        if condition(state) {
          return state
        }
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    if let lastState {
      XCTFail(
        "Timed out waiting for workspace state condition. Last state: scale=\(lastState.canvasScale), offset=(\(lastState.canvasOffsetX), \(lastState.canvasOffsetY)), viewportCount=\(lastState.viewports.count)"
      )
    } else {
      XCTFail("Timed out waiting for workspace state condition")
    }
    return try! XCTUnwrap(workspaceState())
  }

  private func waitForOtherElementFrame(
    identifier: String,
    timeout: TimeInterval = 5,
    condition: (CGRect) -> Bool
  ) -> CGRect {
    let deadline = Date().addingTimeInterval(timeout)
    var lastFrame = CGRect.null
    while Date() < deadline {
      let frame = app.otherElements.matching(identifier: identifier).firstMatch.frame
      if !frame.isEmpty {
        lastFrame = frame
        if condition(frame) {
          return frame
        }
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    XCTFail("Timed out waiting for \(identifier) frame condition. Last frame: \(NSStringFromRect(lastFrame))")
    return app.otherElements.matching(identifier: identifier).firstMatch.frame
  }

  private func viewportCardFrame(index: Int) -> CGRect {
    requireOtherElement("viewport-card-\(index)").frame
  }

  private func waitForViewportChrome(index: Int, includeRightResizeHandle: Bool = false) {
    _ = requireOtherElement("viewport-card-\(index)", timeout: 10)
    _ = requireOtherElement("viewport-header-\(index)", timeout: 10)
    if includeRightResizeHandle {
      _ = requireOtherElement("viewport-resize-right-\(index)", timeout: 10)
    }
  }

  private func surfaceCoordinate(forScreenPoint screenPoint: CGPoint) -> XCUICoordinate {
    let surface = requireOtherElement("canvas-interaction-surface")
    let frame = surface.frame
    return surface.coordinate(withNormalizedOffset: .zero).withOffset(
      CGVector(
        dx: screenPoint.x - frame.minX,
        dy: frame.height - (screenPoint.y - frame.minY)
      )
    )
  }

  @discardableResult
  private func requireOtherElement(_ identifier: String, timeout: TimeInterval = 5) -> XCUIElement {
    let query = app.otherElements.matching(identifier: identifier)
    let element = query.firstMatch
    XCTAssertTrue(element.waitForExistence(timeout: timeout), "Expected other element \(identifier) to exist")
    XCTAssertEqual(query.count, 1, "Expected exactly one other element with identifier \(identifier)")
    return element
  }

  @discardableResult
  private func requireButton(_ identifier: String, timeout: TimeInterval = 5) -> XCUIElement {
    let query = app.buttons.matching(identifier: identifier)
    let element = query.firstMatch
    XCTAssertTrue(element.waitForExistence(timeout: timeout), "Expected button \(identifier) to exist")
    XCTAssertEqual(query.count, 1, "Expected exactly one button with identifier \(identifier)")
    return element
  }

  @discardableResult
  private func requireWebView(labeled label: String, timeout: TimeInterval = 5) -> XCUIElement {
    let predicate = NSPredicate(format: "label == %@", label)
    let query = app.webViews.matching(predicate)
    let element = query.firstMatch
    XCTAssertTrue(element.waitForExistence(timeout: timeout), "Expected web view labeled \(label) to exist")
    XCTAssertEqual(query.count, 1, "Expected exactly one web view labeled \(label)")
    return element
  }

  private func assertFixtureFocusStatus(index: Int, status: String, timeout: TimeInterval = 5) {
    let webView = requireWebView(labeled: viewportLabel(for: index))
    XCTAssertTrue(
      webView.staticTexts["Input Focus: \(status)"].waitForExistence(timeout: timeout),
      "Expected fixture input focus status \(status)"
    )
  }

  private func assertFixtureLastAction(index: Int, action: String, timeout: TimeInterval = 5) {
    let webView = requireWebView(labeled: viewportLabel(for: index))
    XCTAssertTrue(
      webView.staticTexts["Last Action: \(action)"].waitForExistence(timeout: timeout),
      "Expected fixture last action \(action)"
    )
  }

  private func workspaceStateFileURL() -> URL {
    testAppSupportDirectory
      .appendingPathComponent("projects", isDirectory: true)
      .appendingPathComponent(projectSessionSlug, isDirectory: true)
      .appendingPathComponent("workspace-state.json")
  }

  private var projectSessionSlug: String {
    let base = fixtureProjectRoot.lastPathComponent.lowercased()
      .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
      .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    let hash = SHA256.hash(data: Data(fixtureProjectRoot.path.utf8))
      .compactMap { String(format: "%02x", $0) }
      .joined()
      .prefix(8)
    let prefix = base.isEmpty ? "project" : String(base.prefix(36))
    return "\(prefix)-\(hash)"
  }
}
