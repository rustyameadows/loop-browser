import AppKit
import CoreGraphics
import XCTest
@testable import LoopBrowserNative

@MainActor
final class CanvasInputRouterTests: XCTestCase {
  func testEmptyCanvasMouseDownClearsSelectionAndPans() throws {
    let router = CanvasInputRouter()
    router.transform = CanvasTransform(scale: 1, offset: CGSize(width: 30, height: -15))
    router.hitMap = CanvasHitMap(transform: router.transform, viewports: [])

    var didClearSelection = false
    var panOrigin: CGSize?
    var panTranslation: CGSize?
    var didFinishPan = false

    router.onCanvasMouseDown = {
      didClearSelection = true
    }
    router.onPanChanged = { origin, translation in
      panOrigin = origin
      panTranslation = translation
    }
    router.onPanEnded = {
      didFinishPan = true
    }

    router.mouseDown(at: CGPoint(x: 80, y: 120))
    router.mouseDragged(to: CGPoint(x: 132, y: 168), modifierFlags: [])
    router.mouseUp()

    XCTAssertTrue(didClearSelection)
    let resolvedPanOrigin = try XCTUnwrap(panOrigin)
    let resolvedPanTranslation = try XCTUnwrap(panTranslation)
    XCTAssertEqual(resolvedPanOrigin.width, 30, accuracy: 0.0001)
    XCTAssertEqual(resolvedPanOrigin.height, -15, accuracy: 0.0001)
    XCTAssertEqual(resolvedPanTranslation.width, 52, accuracy: 0.0001)
    XCTAssertEqual(resolvedPanTranslation.height, 48, accuracy: 0.0001)
    XCTAssertTrue(didFinishPan)
  }

  func testScrollOnEmptyCanvasRoutesToPanOnly() throws {
    let router = CanvasInputRouter()
    router.hitMap = CanvasHitMap(transform: CanvasTransform(scale: 1, offset: .zero), viewports: [])

    var scrollDeltaX: CGFloat?
    var scrollDeltaY: CGFloat?
    var zoomCallCount = 0

    router.onScrollPan = { deltaX, deltaY in
      scrollDeltaX = deltaX
      scrollDeltaY = deltaY
    }
    router.onPinchZoom = { _, _ in
      zoomCallCount += 1
    }

    router.scroll(at: CGPoint(x: 40, y: 50), deltaX: 12, deltaY: -28)

    XCTAssertEqual(try XCTUnwrap(scrollDeltaX), 12, accuracy: 0.0001)
    XCTAssertEqual(try XCTUnwrap(scrollDeltaY), -28, accuracy: 0.0001)
    XCTAssertEqual(zoomCallCount, 0)
  }

  func testMagnifyOnEmptyCanvasRoutesToZoomOnly() throws {
    let router = CanvasInputRouter()
    router.hitMap = CanvasHitMap(transform: CanvasTransform(scale: 1, offset: .zero), viewports: [])

    var zoomAnchor: CGPoint?
    var zoomFactor: CGFloat?
    var scrollCallCount = 0

    router.onPinchZoom = { point, factor in
      zoomAnchor = point
      zoomFactor = factor
    }
    router.onScrollPan = { _, _ in
      scrollCallCount += 1
    }

    router.magnify(at: CGPoint(x: 320, y: 240), magnification: 0.25)

    let resolvedZoomAnchor = try XCTUnwrap(zoomAnchor)
    XCTAssertEqual(resolvedZoomAnchor.x, 320, accuracy: 0.0001)
    XCTAssertEqual(resolvedZoomAnchor.y, 240, accuracy: 0.0001)
    XCTAssertEqual(try XCTUnwrap(zoomFactor), 1.25, accuracy: 0.0001)
    XCTAssertEqual(scrollCallCount, 0)
  }

  func testHeaderDragUsesGrabOffsetWithoutJumping() throws {
    let viewportID = UUID()
    let frame = ViewportFrame(x: 100, y: 100, width: 800, height: 600)
    let router = CanvasInputRouter()
    router.transform = CanvasTransform(scale: 1, offset: .zero)
    router.hitMap = CanvasHitMap(
      transform: router.transform,
      viewports: [CanvasHitViewport(id: viewportID, frame: frame)]
    )

    var selectedViewportID: UUID?
    var draggedOrigin: CGPoint?
    var finishedViewportID: UUID?

    router.onViewportSelected = { selectedViewportID = $0 }
    router.onViewportDragged = { _, origin in
      draggedOrigin = origin
    }
    router.onViewportDragEnded = {
      finishedViewportID = $0
    }

    router.mouseDown(at: CGPoint(x: 150, y: 120))
    router.mouseDragged(to: CGPoint(x: 240, y: 190), modifierFlags: [])
    router.mouseUp()

    XCTAssertEqual(selectedViewportID, viewportID)
    let resolvedDraggedOrigin = try XCTUnwrap(draggedOrigin)
    XCTAssertEqual(resolvedDraggedOrigin.x, 190, accuracy: 0.0001)
    XCTAssertEqual(resolvedDraggedOrigin.y, 170, accuracy: 0.0001)
    XCTAssertEqual(finishedViewportID, viewportID)
  }

  func testResizeHandleDragUsesSharedResizeMath() throws {
    let viewportID = UUID()
    let frame = ViewportFrame(x: 100, y: 100, width: 800, height: 600)
    let router = CanvasInputRouter()
    router.transform = CanvasTransform(scale: 1, offset: .zero)
    router.hitMap = CanvasHitMap(
      transform: router.transform,
      viewports: [CanvasHitViewport(id: viewportID, frame: frame)]
    )

    var resizedFrame: ViewportFrame?
    var finishedViewportID: UUID?

    router.onViewportResized = { _, frame in
      resizedFrame = frame
    }
    router.onViewportResizeEnded = {
      finishedViewportID = $0
    }

    router.mouseDown(at: CGPoint(x: 902, y: 380))
    router.mouseDragged(to: CGPoint(x: 952, y: 430), modifierFlags: [])
    router.mouseUp()

    let resolvedResizedFrame = try XCTUnwrap(resizedFrame)
    XCTAssertEqual(resolvedResizedFrame.width, 850, accuracy: 0.0001)
    XCTAssertEqual(resolvedResizedFrame.height, 600, accuracy: 0.0001)
    XCTAssertEqual(finishedViewportID, viewportID)
  }

  func testCanvasInteractionViewPassesViewportContentThrough() {
    let viewportID = UUID()
    let view = CanvasInteractionNSView(frame: CGRect(x: 0, y: 0, width: 1400, height: 1000))
    view.router.transform = CanvasTransform(scale: 1, offset: .zero)
    view.router.hitMap = CanvasHitMap(
      transform: view.router.transform,
      viewports: [
        CanvasHitViewport(
          id: viewportID,
          frame: ViewportFrame(x: 100, y: 100, width: 800, height: 600)
        ),
      ]
    )

    XCTAssertTrue(view.hitTest(CGPoint(x: 20, y: 20)) === view)
    XCTAssertTrue(view.hitTest(CGPoint(x: 150, y: 120)) === view)
    XCTAssertTrue(view.hitTest(CGPoint(x: 902, y: 380)) === view)
    XCTAssertNil(view.hitTest(CGPoint(x: 260, y: 240)))
    XCTAssertNil(view.hitTest(CGPoint(x: 840, y: 122)))
  }

  func testCanvasInteractionViewUsesFlippedCoordinates() {
    XCTAssertTrue(CanvasInteractionNSView(frame: .zero).isFlipped)
  }
}
