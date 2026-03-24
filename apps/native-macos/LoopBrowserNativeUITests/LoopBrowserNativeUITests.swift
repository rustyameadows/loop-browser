import CryptoKit
import XCTest

final class LoopBrowserNativeUITests: XCTestCase {
  private struct CanvasDragResult {
    let beforeState: UITestWorkspaceState
    let afterState: UITestWorkspaceState
    let actualOffset: CGVector
  }

  private struct ViewportMoveResult {
    let beforeState: UITestWorkspaceState
    let afterState: UITestWorkspaceState
    let beforeFrame: CGRect
    let afterFrame: CGRect
    let actualOffset: CGVector
  }

  private struct ViewportResizeResult {
    let beforeState: UITestWorkspaceState
    let afterState: UITestWorkspaceState
    let beforeFrame: CGRect
    let afterFrame: CGRect
    let actualOffset: CGVector
  }

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

    let panResult = dragCanvas(
      context: "focus escape canvas pan",
      by: preferredCanvasDragVector(
        horizontalDirection: 1,
        verticalDirection: 1,
        horizontalFraction: 0.14,
        verticalFraction: 0.10
      ),
      minimumDistance: 40
    )
    assertCanvasPanMatchesDeliveredOffset(panResult)
    assertFixtureFocusStatus(index: 0, status: "blurred")

    let moveResult = dragViewportHeader(
      index: 0,
      delta: preferredViewportMoveDelta(
        index: 0,
        horizontalDirection: 1,
        verticalDirection: 1,
        horizontalFraction: 0.28,
        verticalFraction: 0.22
      )
    )
    assertViewportMoveMatchesDeliveredOffset(moveResult, index: 0)
    XCTAssertEqual(requireOtherElement("viewport-card-0").value as? String, "selected")
  }

  func testCompositeCanvasWorkflowRemainsInteractive() {
    let baselineState = try! XCTUnwrap(workspaceState())
    let baselineViewportA = viewportCardFrame(index: 0)
    focusViewportInput(index: 0, text: "Focus trap")

    let firstPan = dragCanvas(
      context: "composite initial pan after focus",
      by: preferredCanvasDragVector(
        horizontalDirection: 1,
        verticalDirection: 1,
        horizontalFraction: 0.12,
        verticalFraction: 0.09
      ),
      minimumDistance: 36
    )
    assertCanvasPanMatchesDeliveredOffset(firstPan)

    let zoomedOutState = zoomOut(times: 6)
    XCTAssertLessThan(zoomedOutState.canvasScale, baselineState.canvasScale * 0.65)

    let secondPan = dragCanvas(
      context: "composite pan after zoom out",
      by: preferredCanvasDragVector(
        horizontalDirection: -1,
        verticalDirection: 1,
        horizontalFraction: 0.18,
        verticalFraction: 0.14
      ),
      minimumDistance: 44
    )
    assertCanvasPanMatchesDeliveredOffset(secondPan)

    let zoomedInState = zoomIn(times: 4)
    XCTAssertGreaterThan(zoomedInState.canvasScale, zoomedOutState.canvasScale * 1.55)

    let thirdPan = dragCanvas(
      context: "composite pan after zoom in",
      by: preferredCanvasDragVector(
        horizontalDirection: 1,
        verticalDirection: -1,
        horizontalFraction: 0.16,
        verticalFraction: 0.11
      ),
      minimumDistance: 44
    )
    assertCanvasPanMatchesDeliveredOffset(thirdPan)

    let movedViewportA = dragViewportHeader(
      index: 0,
      delta: preferredViewportMoveDelta(
        index: 0,
        horizontalDirection: 1,
        verticalDirection: 1,
        horizontalFraction: 0.30,
        verticalFraction: 0.25
      )
    )
    assertViewportMoveMatchesDeliveredOffset(movedViewportA, index: 0)
    XCTAssertEqual(requireOtherElement("viewport-card-0").value as? String, "selected")
    XCTAssertGreaterThan(abs(movedViewportA.afterFrame.minX - baselineViewportA.minX), max(24, abs(movedViewportA.actualOffset.dx) * 0.35))
    XCTAssertGreaterThan(abs(movedViewportA.afterFrame.minY - baselineViewportA.minY), max(18, abs(movedViewportA.actualOffset.dy) * 0.30))

    let resetState = resetCanvasZoom()
    let resetViewportA = viewportCardFrame(index: 0)
    XCTAssertEqual(resetState.canvasScale, 1, accuracy: 0.03)
    XCTAssertEqual(resetViewportA.width, baselineViewportA.width, accuracy: 16)
    XCTAssertEqual(resetViewportA.height, baselineViewportA.height, accuracy: 16)
    XCTAssertGreaterThan(abs(resetViewportA.minX - baselineViewportA.minX), max(24, abs(movedViewportA.actualOffset.dx) * 0.35))

    let fourthPan = dragCanvas(
      context: "composite pan after actual size",
      by: preferredCanvasDragVector(
        horizontalDirection: -1,
        verticalDirection: 1,
        horizontalFraction: 0.14,
        verticalFraction: 0.13
      ),
      minimumDistance: 40
    )
    assertCanvasPanMatchesDeliveredOffset(fourthPan)

    let resizedViewportB = resizeViewportRight(
      index: 1,
      deltaX: preferredRightResizeDelta(index: 1, horizontalFraction: 0.24)
    )
    assertViewportResizeMatchesDeliveredOffset(resizedViewportB, index: 1)
    XCTAssertEqual(requireOtherElement("viewport-card-1").value as? String, "selected")

    let resizedState = resizedViewportB.afterState
    XCTAssertGreaterThan(
      resizedState.viewports[1].frame.width - baselineState.viewports[1].frame.width,
      max(24, Double(abs(resizedViewportB.actualOffset.dx / max(CGFloat(resizedViewportB.beforeState.canvasScale), 0.0001))) * 0.55)
    )

    let deeplyZoomedOutState = zoomOut(times: 10)
    XCTAssertLessThan(deeplyZoomedOutState.canvasScale, 0.45)

    let fifthPan = dragCanvas(
      context: "composite pan after deep zoom out",
      by: preferredCanvasDragVector(
        horizontalDirection: 1,
        verticalDirection: 1,
        horizontalFraction: 0.20,
        verticalFraction: 0.16
      ),
      minimumDistance: 52
    )
    assertCanvasPanMatchesDeliveredOffset(fifthPan)

    let movedViewportBAgain = dragViewportHeader(
      index: 1,
      delta: preferredViewportMoveDelta(
        index: 1,
        horizontalDirection: -1,
        verticalDirection: 1,
        horizontalFraction: 0.26,
        verticalFraction: 0.20
      )
    )
    assertViewportMoveMatchesDeliveredOffset(movedViewportBAgain, index: 1)
    XCTAssertEqual(requireOtherElement("viewport-card-1").value as? String, "selected")

    let finalState = movedViewportBAgain.afterState
    let expectedMoveBAgainX = Double(movedViewportBAgain.actualOffset.dx / max(CGFloat(movedViewportBAgain.beforeState.canvasScale), 0.0001))
    let expectedMoveBAgainY = Double(movedViewportBAgain.actualOffset.dy / max(CGFloat(movedViewportBAgain.beforeState.canvasScale), 0.0001))
    XCTAssertGreaterThan(
      abs(finalState.viewports[1].frame.x - resizedState.viewports[1].frame.x),
      max(18, abs(expectedMoveBAgainX) * 0.55)
    )
    XCTAssertGreaterThan(
      abs(finalState.viewports[1].frame.y - resizedState.viewports[1].frame.y),
      max(14, abs(expectedMoveBAgainY) * 0.55)
    )

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

    let candidateFocusTargets = [
      webView.buttons["Fixture Input Panel"].firstMatch,
      webView.otherElements["Fixture Input Panel"].firstMatch,
      textField,
    ]

    var didFocusInput = false
    var typedValue = ""
    for _ in 0..<2 {
      for target in candidateFocusTargets where target.exists {
        target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
        if fixtureFocusStatusIsVisible(index: index, status: "focused", timeout: 1.5) {
          didFocusInput = true
          break
        }
      }
      if fixtureFocusStatusIsVisible(index: index, status: "focused", timeout: 1.5) {
        didFocusInput = true
      }
      textField.typeText(text)
      typedValue = waitForTextFieldValue(textField, timeout: 2)
      if !typedValue.contains(text) {
        app.typeText(text)
      }
      typedValue = waitForTextFieldValue(textField, timeout: 2)
      if typedValue.contains(text) {
        didFocusInput = true
        break
      }
    }

    XCTAssertTrue(typedValue.contains(text), "Expected text field value to contain \(text), got \(typedValue)")
    XCTAssertTrue(
      didFocusInput || fixtureLastActionIsVisible(index: index, action: "input-focus", timeout: 2),
      "Expected fixture input interaction to establish editable focus before typing"
    )
    XCTAssertTrue(
      fixtureFocusStatusIsVisible(index: index, status: "focused", timeout: 2)
        || fixtureLastActionIsVisible(index: index, action: "input-focus", timeout: 2),
      "Expected a visible focused-input signal after typing"
    )
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
    context: String = "canvas drag",
    by translation: CGVector,
    minimumDistance: Double
  ) -> CanvasDragResult {
    let before = try! XCTUnwrap(workspaceState())
    let surfaceFrame = requireOtherElement("canvas-interaction-surface").frame
    let visibleFrames = before.viewports.indices.map { viewportCardFrame(index: $0) }
    let projectedFrames = before.viewports.map { projectedViewportScreenRect(for: $0.frame, state: before, surfaceFrame: surfaceFrame) }
    let excludedFrames = visibleFrames + projectedFrames
    let candidatePoints = candidateEmptyCanvasScreenPoints(excluding: excludedFrames, within: surfaceFrame)
    var lastAttemptOffset = CGVector.zero

    for startPoint in candidatePoints {
      let endPoint = clampedScreenPoint(
        CGPoint(x: startPoint.x + translation.dx, y: startPoint.y + translation.dy),
        to: surfaceFrame,
        padding: 44
      )
      let actualOffset = CGVector(
        dx: endPoint.x - startPoint.x,
        dy: endPoint.y - startPoint.y
      )
      lastAttemptOffset = actualOffset
      let start = surfaceCoordinate(forScreenPoint: startPoint)
      let end = surfaceCoordinate(forScreenPoint: endPoint)

      start.press(forDuration: 0.05, thenDragTo: end)

      if let movedState = pollWorkspaceState(timeout: 1.5, condition: { state in
        hypot(
          state.canvasOffsetX - before.canvasOffsetX,
          state.canvasOffsetY - before.canvasOffsetY
        ) > minimumDistance
      }) {
        return CanvasDragResult(beforeState: before, afterState: movedState, actualOffset: actualOffset)
      }
    }

    if let lastState = workspaceState() {
      XCTFail(
        "Timed out waiting for \(context). Last state: scale=\(lastState.canvasScale), offset=(\(lastState.canvasOffsetX), \(lastState.canvasOffsetY)), viewportCount=\(lastState.viewports.count)"
      )
      return CanvasDragResult(beforeState: before, afterState: lastState, actualOffset: lastAttemptOffset)
    }

    XCTFail("Timed out waiting for \(context)")
    return CanvasDragResult(beforeState: before, afterState: before, actualOffset: lastAttemptOffset)
  }

  @discardableResult
  private func dragViewportHeader(index: Int, delta: CGVector) -> ViewportMoveResult {
    let beforeState = try! XCTUnwrap(workspaceState())
    let beforeFrame = viewportCardFrame(index: index)
    let header = requireOtherElement("viewport-header-\(index)")
    let start = header.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    let surfaceFrame = requireOtherElement("canvas-interaction-surface").frame
    let startPoint = CGPoint(x: header.frame.midX, y: header.frame.midY)
    let actualOffset = clampedDragOffset(
      from: startPoint,
      desiredOffset: delta,
      within: surfaceFrame,
      padding: 36
    )
    let endPoint = CGPoint(x: startPoint.x + actualOffset.dx, y: startPoint.y + actualOffset.dy)
    let end = surfaceCoordinate(forScreenPoint: endPoint)
    start.press(forDuration: 0.05, thenDragTo: end)

    let scale = max(CGFloat(beforeState.canvasScale), 0.0001)
    let minimumHorizontalMovement = max(18 / scale, abs(actualOffset.dx) / scale * 0.45)
    let minimumVerticalMovement = max(14 / scale, abs(actualOffset.dy) / scale * 0.45)
    let afterState = waitForWorkspaceState(timeout: 10) { state in
      guard state.viewports.indices.contains(index), beforeState.viewports.indices.contains(index) else {
        return false
      }
      return abs(state.viewports[index].frame.x - beforeState.viewports[index].frame.x) > minimumHorizontalMovement
        && abs(state.viewports[index].frame.y - beforeState.viewports[index].frame.y) > minimumVerticalMovement
    }
    let afterFrame = waitForOtherElementFrame(identifier: "viewport-card-\(index)", timeout: 10) { frame in
      abs(frame.minX - beforeFrame.minX) > max(18, abs(actualOffset.dx) * 0.35)
        && abs(frame.minY - beforeFrame.minY) > max(14, abs(actualOffset.dy) * 0.30)
    }

    return ViewportMoveResult(
      beforeState: beforeState,
      afterState: afterState,
      beforeFrame: beforeFrame,
      afterFrame: afterFrame,
      actualOffset: actualOffset
    )
  }

  @discardableResult
  private func resizeViewportRight(index: Int, deltaX: CGFloat) -> ViewportResizeResult {
    let beforeState = try! XCTUnwrap(workspaceState())
    let beforeFrame = viewportCardFrame(index: index)
    let handle = requireOtherElement("viewport-resize-right-\(index)")
    let start = handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    let surfaceFrame = requireOtherElement("canvas-interaction-surface").frame
    let startPoint = CGPoint(x: handle.frame.midX, y: handle.frame.midY)
    let actualOffset = clampedDragOffset(
      from: startPoint,
      desiredOffset: CGVector(dx: deltaX, dy: 0),
      within: surfaceFrame,
      padding: 28
    )
    let endPoint = CGPoint(x: startPoint.x + actualOffset.dx, y: startPoint.y + actualOffset.dy)
    let end = surfaceCoordinate(forScreenPoint: endPoint)
    start.press(forDuration: 0.05, thenDragTo: end)

    let scale = max(CGFloat(beforeState.canvasScale), 0.0001)
    let minimumWidthGain = max(18 / scale, abs(actualOffset.dx) / scale * 0.5)
    let afterState = waitForWorkspaceState(timeout: 10) { state in
      guard state.viewports.indices.contains(index), beforeState.viewports.indices.contains(index) else {
        return false
      }
      return state.viewports[index].frame.width - beforeState.viewports[index].frame.width > minimumWidthGain
    }
    let afterFrame = waitForOtherElementFrame(identifier: "viewport-card-\(index)", timeout: 10) { frame in
      frame.width - beforeFrame.width > max(18, abs(actualOffset.dx) * 0.45)
    }

    return ViewportResizeResult(
      beforeState: beforeState,
      afterState: afterState,
      beforeFrame: beforeFrame,
      afterFrame: afterFrame,
      actualOffset: actualOffset
    )
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

  private func candidateEmptyCanvasScreenPoints(excluding frames: [CGRect], within surfaceFrame: CGRect) -> [CGPoint] {
    let expandedFrames = frames.map { $0.insetBy(dx: -12, dy: -12) }
    let insetPairs = [
      CGSize(width: min(96, surfaceFrame.width * 0.12), height: min(96, surfaceFrame.height * 0.12)),
      CGSize(width: 72, height: 72),
      CGSize(width: 48, height: 48),
      CGSize(width: 24, height: 24),
      CGSize(width: 12, height: 12),
    ]

    for inset in insetPairs {
      let safeSurfaceFrame = surfaceFrame.insetBy(dx: inset.width, dy: inset.height)
      guard safeSurfaceFrame.width > 0, safeSurfaceFrame.height > 0 else { continue }

      let surfaceCenter = CGPoint(x: safeSurfaceFrame.midX, y: safeSurfaceFrame.midY)
      var candidatePoints = [CGPoint]()
      let gridFractions: [CGFloat] = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]
      for yFraction in gridFractions {
        for xFraction in gridFractions {
          candidatePoints.append(
            CGPoint(
              x: safeSurfaceFrame.minX + safeSurfaceFrame.width * xFraction,
              y: safeSurfaceFrame.minY + safeSurfaceFrame.height * yFraction
            )
          )
        }
      }
      candidatePoints.append(contentsOf: [
        CGPoint(x: safeSurfaceFrame.minX, y: safeSurfaceFrame.minY),
        CGPoint(x: safeSurfaceFrame.maxX, y: safeSurfaceFrame.minY),
        CGPoint(x: safeSurfaceFrame.minX, y: safeSurfaceFrame.maxY),
        CGPoint(x: safeSurfaceFrame.maxX, y: safeSurfaceFrame.maxY),
        CGPoint(x: safeSurfaceFrame.midX, y: safeSurfaceFrame.minY),
        CGPoint(x: safeSurfaceFrame.midX, y: safeSurfaceFrame.maxY),
        CGPoint(x: safeSurfaceFrame.minX, y: safeSurfaceFrame.midY),
        CGPoint(x: safeSurfaceFrame.maxX, y: safeSurfaceFrame.midY),
      ])

      for frame in expandedFrames {
        candidatePoints.append(CGPoint(x: frame.midX, y: frame.minY - 84))
        candidatePoints.append(CGPoint(x: frame.midX, y: frame.maxY + 84))
        candidatePoints.append(CGPoint(x: frame.minX - 84, y: frame.midY))
        candidatePoints.append(CGPoint(x: frame.maxX + 84, y: frame.midY))
      }

      let validPoints = candidatePoints.filter { point in
        safeSurfaceFrame.contains(point) && !expandedFrames.contains(where: { $0.contains(point) })
      }

      let rankedPoints = validPoints.sorted(by: { left, right in
        hypot(left.x - surfaceCenter.x, left.y - surfaceCenter.y)
          < hypot(right.x - surfaceCenter.x, right.y - surfaceCenter.y)
      })

      if !rankedPoints.isEmpty {
        return rankedPoints
      }
    }

    XCTFail("Could not find an empty canvas point outside current viewport frames")
    return [CGPoint(x: surfaceFrame.midX, y: surfaceFrame.midY)]
  }

  private func projectedViewportScreenRect(
    for frame: UITestWorkspaceState.Viewport.Frame,
    state: UITestWorkspaceState,
    surfaceFrame: CGRect
  ) -> CGRect {
    CGRect(
      x: surfaceFrame.minX + frame.x * state.canvasScale + state.canvasOffsetX,
      y: surfaceFrame.minY + frame.y * state.canvasScale + state.canvasOffsetY,
      width: frame.width * state.canvasScale,
      height: frame.height * state.canvasScale
    )
  }

  private func preferredCanvasDragVector(
    horizontalDirection: CGFloat,
    verticalDirection: CGFloat,
    horizontalFraction: CGFloat,
    verticalFraction: CGFloat
  ) -> CGVector {
    let surfaceFrame = requireOtherElement("canvas-interaction-surface").frame.insetBy(dx: 72, dy: 72)
    return CGVector(
      dx: horizontalDirection * max(44, surfaceFrame.width * horizontalFraction),
      dy: verticalDirection * max(36, surfaceFrame.height * verticalFraction)
    )
  }

  private func preferredViewportMoveDelta(
    index: Int,
    horizontalDirection: CGFloat,
    verticalDirection: CGFloat,
    horizontalFraction: CGFloat,
    verticalFraction: CGFloat
  ) -> CGVector {
    let surfaceFrame = requireOtherElement("canvas-interaction-surface").frame.insetBy(dx: 48, dy: 48)
    let headerFrame = requireOtherElement("viewport-header-\(index)").frame
    let headerPoint = CGPoint(x: headerFrame.midX, y: headerFrame.midY)
    let availableHorizontalDistance =
      horizontalDirection >= 0
      ? max(surfaceFrame.maxX - headerPoint.x, 0)
      : max(headerPoint.x - surfaceFrame.minX, 0)
    let availableVerticalDistance =
      verticalDirection >= 0
      ? max(surfaceFrame.maxY - headerPoint.y, 0)
      : max(headerPoint.y - surfaceFrame.minY, 0)
    return CGVector(
      dx: horizontalDirection * max(56, availableHorizontalDistance * horizontalFraction),
      dy: verticalDirection * max(44, availableVerticalDistance * verticalFraction)
    )
  }

  private func assertCanvasPanMatchesDeliveredOffset(_ result: CanvasDragResult) {
    let offsetDeltaX = result.afterState.canvasOffsetX - result.beforeState.canvasOffsetX
    let offsetDeltaY = result.afterState.canvasOffsetY - result.beforeState.canvasOffsetY
    XCTAssertEqual(offsetDeltaX, result.actualOffset.dx, accuracy: max(18, abs(result.actualOffset.dx) * 0.4))
    XCTAssertEqual(offsetDeltaY, result.actualOffset.dy, accuracy: max(18, abs(result.actualOffset.dy) * 0.4))
  }

  private func assertViewportMoveMatchesDeliveredOffset(_ result: ViewportMoveResult, index: Int) {
    let scale = max(CGFloat(result.beforeState.canvasScale), 0.0001)
    let expectedWorldDeltaX = Double(result.actualOffset.dx / scale)
    let expectedWorldDeltaY = Double(result.actualOffset.dy / scale)
    let worldDeltaX = result.afterState.viewports[index].frame.x - result.beforeState.viewports[index].frame.x
    let worldDeltaY = result.afterState.viewports[index].frame.y - result.beforeState.viewports[index].frame.y
    XCTAssertEqual(worldDeltaX, expectedWorldDeltaX, accuracy: max(18 / Double(scale), abs(expectedWorldDeltaX) * 0.45))
    XCTAssertEqual(worldDeltaY, expectedWorldDeltaY, accuracy: max(14 / Double(scale), abs(expectedWorldDeltaY) * 0.45))
    XCTAssertEqual(
      abs(result.afterFrame.minX - result.beforeFrame.minX),
      abs(result.actualOffset.dx),
      accuracy: max(18, abs(result.actualOffset.dx) * 0.45)
    )
    XCTAssertEqual(
      abs(result.afterFrame.minY - result.beforeFrame.minY),
      abs(result.actualOffset.dy),
      accuracy: max(14, abs(result.actualOffset.dy) * 0.45)
    )
  }

  private func assertViewportResizeMatchesDeliveredOffset(_ result: ViewportResizeResult, index: Int) {
    let scale = max(CGFloat(result.beforeState.canvasScale), 0.0001)
    let expectedWidthGain = Double(result.actualOffset.dx / scale)
    let worldWidthGain = result.afterState.viewports[index].frame.width - result.beforeState.viewports[index].frame.width
    XCTAssertEqual(worldWidthGain, expectedWidthGain, accuracy: max(18 / Double(scale), abs(expectedWidthGain) * 0.5))
    XCTAssertEqual(
      result.afterFrame.width - result.beforeFrame.width,
      result.actualOffset.dx,
      accuracy: max(18, abs(result.actualOffset.dx) * 0.5)
    )
    XCTAssertEqual(result.afterFrame.height, result.beforeFrame.height, accuracy: 12)
  }

  private func preferredRightResizeDelta(index: Int, horizontalFraction: CGFloat) -> CGFloat {
    let handleFrame = requireOtherElement("viewport-resize-right-\(index)").frame
    let surfaceFrame = requireOtherElement("canvas-interaction-surface").frame.insetBy(dx: 40, dy: 40)
    return max(60, max(surfaceFrame.maxX - handleFrame.midX, 0) * horizontalFraction)
  }

  private func waitForNonExistence(of element: XCUIElement, timeout: TimeInterval = 5) -> Bool {
    let predicate = NSPredicate(format: "exists == false")
    let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
    return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
  }

  private func waitForTextFieldValue(_ element: XCUIElement, timeout: TimeInterval = 5) -> String {
    let deadline = Date().addingTimeInterval(timeout)
    var lastValue = element.value as? String ?? ""
    while Date() < deadline {
      lastValue = element.value as? String ?? ""
      if !lastValue.isEmpty, lastValue != "Type into the viewport" {
        return lastValue
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    return lastValue
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
    if let state = pollWorkspaceState(timeout: timeout, condition: condition) {
      return state
    }
    if let lastState = workspaceState() {
      XCTFail(
        "Timed out waiting for workspace state condition. Last state: scale=\(lastState.canvasScale), offset=(\(lastState.canvasOffsetX), \(lastState.canvasOffsetY)), viewportCount=\(lastState.viewports.count)"
      )
    } else {
      XCTFail("Timed out waiting for workspace state condition")
    }
    return try! XCTUnwrap(workspaceState())
  }

  private func pollWorkspaceState(
    timeout: TimeInterval = 5,
    condition: (UITestWorkspaceState) -> Bool
  ) -> UITestWorkspaceState? {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if let state = workspaceState() {
        if condition(state) {
          return state
        }
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    return nil
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
        dy: screenPoint.y - frame.minY
      )
    )
  }

  private func clampedScreenPoint(_ point: CGPoint, to frame: CGRect, padding: CGFloat) -> CGPoint {
    let safeFrame = frame.insetBy(dx: padding, dy: padding)
    return CGPoint(
      x: min(max(point.x, safeFrame.minX), safeFrame.maxX),
      y: min(max(point.y, safeFrame.minY), safeFrame.maxY)
    )
  }

  private func clampedDragOffset(
    from startPoint: CGPoint,
    desiredOffset: CGVector,
    within frame: CGRect,
    padding: CGFloat
  ) -> CGVector {
    let clampedEndPoint = clampedScreenPoint(
      CGPoint(x: startPoint.x + desiredOffset.dx, y: startPoint.y + desiredOffset.dy),
      to: frame,
      padding: padding
    )
    return CGVector(
      dx: clampedEndPoint.x - startPoint.x,
      dy: clampedEndPoint.y - startPoint.y
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
    XCTAssertTrue(fixtureFocusStatusIsVisible(index: index, status: status, timeout: timeout), "Expected fixture input focus status \(status)")
  }

  private func assertFixtureLastAction(index: Int, action: String, timeout: TimeInterval = 5) {
    XCTAssertTrue(
      fixtureLastActionIsVisible(index: index, action: action, timeout: timeout),
      "Expected fixture last action \(action)"
    )
  }

  private func fixtureFocusStatusIsVisible(index: Int, status: String, timeout: TimeInterval = 5) -> Bool {
    let webView = requireWebView(labeled: viewportLabel(for: index))
    return webView.staticTexts["Input Focus: \(status)"].waitForExistence(timeout: timeout)
  }

  private func fixtureLastActionIsVisible(index: Int, action: String, timeout: TimeInterval = 5) -> Bool {
    let webView = requireWebView(labeled: viewportLabel(for: index))
    return webView.staticTexts["Last Action: \(action)"].waitForExistence(timeout: timeout)
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
