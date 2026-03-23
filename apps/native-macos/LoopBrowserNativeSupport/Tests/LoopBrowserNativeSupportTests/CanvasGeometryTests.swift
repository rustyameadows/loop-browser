import CoreGraphics
import XCTest
@testable import LoopBrowserNativeSupport

final class CanvasGeometryTests: XCTestCase {
  func testVisibleCanvasCenterUsesTransformAndViewportSize() {
    let center = CanvasInteractionMath.visibleCanvasCenter(
      viewportSize: CGSize(width: 1200, height: 800),
      transform: CanvasTransform(scale: 2, offset: CGSize(width: 100, height: -40))
    )

    XCTAssertEqual(center.x, 250, accuracy: 0.0001)
    XCTAssertEqual(center.y, 220, accuracy: 0.0001)
  }

  func testZoomedTransformKeepsPointerAnchored() {
    let initialTransform = CanvasTransform(scale: 1, offset: CGSize(width: 120, height: 80))
    let pointer = CGPoint(x: 640, y: 360)
    let worldPoint = CanvasInteractionMath.canvasPoint(
      viewportPoint: pointer,
      transform: initialTransform
    )

    let transform = CanvasInteractionMath.zoomedTransform(
      viewportPoint: pointer,
      zoomFactor: 1.75,
      transform: initialTransform,
      minimumScale: 0.1,
      maximumScale: 6
    )

    let after = CanvasInteractionMath.viewportRect(
      for: ViewportFrame(x: worldPoint.x, y: worldPoint.y, width: 0, height: 0),
      transform: transform
    ).origin

    XCTAssertEqual(after.x, pointer.x, accuracy: 0.0001)
    XCTAssertEqual(after.y, pointer.y, accuracy: 0.0001)
  }

  func testZoomedTransformClampsScaleRange() {
    let minimum = CanvasInteractionMath.zoomedTransform(
      viewportPoint: .zero,
      zoomFactor: 0.01,
      transform: CanvasTransform(scale: 0.2, offset: .zero),
      minimumScale: 0.1,
      maximumScale: 6
    )
    XCTAssertEqual(minimum.scale, 0.1, accuracy: 0.0001)

    let maximum = CanvasInteractionMath.zoomedTransform(
      viewportPoint: .zero,
      zoomFactor: 10,
      transform: CanvasTransform(scale: 4, offset: .zero),
      minimumScale: 0.1,
      maximumScale: 6
    )
    XCTAssertEqual(maximum.scale, 6, accuracy: 0.0001)
  }

  func testRepeatedZoomInAndOutReturnsNearOriginalTransform() {
    let pointer = CGPoint(x: 640, y: 360)
    let original = CanvasTransform(scale: 1, offset: CGSize(width: 120, height: 80))
    var transform = original

    for _ in 0..<6 {
      transform = CanvasInteractionMath.zoomedTransform(
        viewportPoint: pointer,
        zoomFactor: 1.15,
        transform: transform,
        minimumScale: 0.1,
        maximumScale: 6
      )
      transform = CanvasInteractionMath.zoomedTransform(
        viewportPoint: pointer,
        zoomFactor: 1 / 1.15,
        transform: transform,
        minimumScale: 0.1,
        maximumScale: 6
      )
    }

    XCTAssertEqual(transform.scale, original.scale, accuracy: 0.0001)
    XCTAssertEqual(transform.offset.width, original.offset.width, accuracy: 0.0001)
    XCTAssertEqual(transform.offset.height, original.offset.height, accuracy: 0.0001)
  }

  func testPannedOffsetAddsTranslation() {
    let offset = CanvasInteractionMath.pannedOffset(
      origin: CGSize(width: 20, height: -15),
      translation: CGSize(width: 60, height: 35)
    )

    XCTAssertEqual(offset.width, 80, accuracy: 0.0001)
    XCTAssertEqual(offset.height, 20, accuracy: 0.0001)
  }

  func testPannedOffsetAddsScrollDeltas() {
    let offset = CanvasInteractionMath.pannedOffset(
      origin: CGSize(width: -20, height: 45),
      deltaX: 18,
      deltaY: -24
    )

    XCTAssertEqual(offset.width, -2, accuracy: 0.0001)
    XCTAssertEqual(offset.height, 21, accuracy: 0.0001)
  }

  func testCanvasHitMapFindsHeaderDragRegionBeforePassthrough() {
    let viewportID = UUID()
    let hitMap = CanvasHitMap(
      transform: CanvasTransform(scale: 0.5, offset: CGSize(width: 40, height: 20))
      ,
      viewports: [
        CanvasHitViewport(
          id: viewportID,
          frame: ViewportFrame(x: 100, y: 80, width: 600, height: 400)
        ),
      ]
    )

    let headerPoint = CGPoint(x: 110, y: 68)
    let passthroughPoint = CGPoint(x: 210, y: 180)

    XCTAssertEqual(hitMap.region(at: headerPoint), .viewportHeader(viewportID))
    XCTAssertEqual(hitMap.region(at: passthroughPoint), .viewportPassthrough(viewportID))
  }

  func testCanvasHitMapLeavesControlClusterAsPassthrough() {
    let viewportID = UUID()
    let hitMap = CanvasHitMap(
      transform: CanvasTransform(scale: 1, offset: .zero),
      viewports: [
        CanvasHitViewport(
          id: viewportID,
          frame: ViewportFrame(x: 100, y: 100, width: 800, height: 600)
        ),
      ]
    )

    let controlClusterPoint = CGPoint(x: 840, y: 122)

    XCTAssertEqual(hitMap.region(at: controlClusterPoint), .viewportPassthrough(viewportID))
  }

  func testCanvasHitMapDetectsHandlesOutsideViewportBody() {
    let viewportID = UUID()
    let hitMap = CanvasHitMap(
      transform: CanvasTransform(scale: 1, offset: .zero),
      viewports: [
        CanvasHitViewport(
          id: viewportID,
          frame: ViewportFrame(x: 100, y: 120, width: 600, height: 400)
        ),
      ]
    )

    XCTAssertEqual(
      hitMap.region(at: CGPoint(x: 98, y: 118)),
      .viewportHandle(viewportID, .topLeft)
    )
    XCTAssertEqual(
      hitMap.region(at: CGPoint(x: 402, y: 108)),
      .viewportHandle(viewportID, .top)
    )
  }

  func testCanvasHitMapUsesFrontmostViewportLastInOrder() {
    let backID = UUID()
    let frontID = UUID()
    let hitMap = CanvasHitMap(
      transform: CanvasTransform(scale: 1, offset: .zero),
      viewports: [
        CanvasHitViewport(
          id: backID,
          frame: ViewportFrame(x: 100, y: 100, width: 500, height: 300)
        ),
        CanvasHitViewport(
          id: frontID,
          frame: ViewportFrame(x: 120, y: 120, width: 500, height: 300)
        ),
      ]
    )

    XCTAssertEqual(
      hitMap.region(at: CGPoint(x: 160, y: 150)),
      .viewportHeader(frontID)
    )
  }

  func testResizeHandleEdgeResizeOnlyChangesOneAxis() {
    let frame = ViewportFrame(x: 100, y: 120, width: 800, height: 600)

    let resized = ViewportResizeHandle.right.resizedFrame(
      from: frame,
      deltaX: 120,
      deltaY: 90,
      symmetric: false
    )

    XCTAssertEqual(resized.x, frame.x, accuracy: 0.0001)
    XCTAssertEqual(resized.y, frame.y, accuracy: 0.0001)
    XCTAssertEqual(resized.width, 920, accuracy: 0.0001)
    XCTAssertEqual(resized.height, 600, accuracy: 0.0001)
  }

  func testDraggedViewportOriginPreservesGrabOffset() {
    let origin = CanvasInteractionMath.draggedViewportOrigin(
      currentCanvasPoint: CGPoint(x: 190, y: 200),
      grabOffset: CGSize(width: 30, height: 25)
    )

    XCTAssertEqual(origin.x, 160, accuracy: 0.0001)
    XCTAssertEqual(origin.y, 175, accuracy: 0.0001)
  }

  func testResizeHandleSymmetricResizeMirrorsOppositeEdge() {
    let frame = ViewportFrame(x: 200, y: 240, width: 600, height: 400)

    let resized = ViewportResizeHandle.left.resizedFrame(
      from: frame,
      deltaX: -40,
      deltaY: 0,
      symmetric: true
    )

    XCTAssertEqual(resized.width, 680, accuracy: 0.0001)
    XCTAssertEqual(resized.x, 160, accuracy: 0.0001)
    XCTAssertEqual(resized.height, frame.height, accuracy: 0.0001)
  }

  func testSpawnedViewportFrameCentersAndStaggers() {
    let frame = CanvasInteractionMath.spawnedViewportFrame(
      center: CGPoint(x: 900, y: 500),
      width: 1200,
      height: 800,
      staggerIndex: 2
    )

    XCTAssertEqual(frame.x, 388, accuracy: 0.0001)
    XCTAssertEqual(frame.y, 188, accuracy: 0.0001)
    XCTAssertEqual(frame.width, 1200, accuracy: 0.0001)
    XCTAssertEqual(frame.height, 800, accuracy: 0.0001)
  }
}
