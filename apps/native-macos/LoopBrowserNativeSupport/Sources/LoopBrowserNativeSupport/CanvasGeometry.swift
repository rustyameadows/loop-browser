import CoreGraphics
import Foundation

struct ViewportFrame: Codable, Equatable {
  var x: Double
  var y: Double
  var width: Double
  var height: Double
}

struct CanvasTransform: Equatable {
  var scale: CGFloat
  var offset: CGSize
}

struct CanvasHitViewport: Equatable {
  var id: UUID
  var frame: ViewportFrame
}

enum CanvasHitRegion: Equatable {
  case emptyCanvas
  case viewportHeader(UUID)
  case viewportHandle(UUID, ViewportResizeHandle)
  case viewportPassthrough(UUID)
}

enum ViewportResizeHandle: CaseIterable, Hashable {
  case top
  case bottom
  case left
  case right
  case topLeft
  case topRight
  case bottomLeft
  case bottomRight

  var affectsLeftEdge: Bool {
    self == .left || self == .topLeft || self == .bottomLeft
  }

  var affectsRightEdge: Bool {
    self == .right || self == .topRight || self == .bottomRight
  }

  var affectsTopEdge: Bool {
    self == .top || self == .topLeft || self == .topRight
  }

  var affectsBottomEdge: Bool {
    self == .bottom || self == .bottomLeft || self == .bottomRight
  }

  var showsHorizontalIndicator: Bool {
    self == .top || self == .bottom
  }

  var showsVerticalIndicator: Bool {
    self == .left || self == .right
  }

  func resizedFrame(
    from original: ViewportFrame,
    deltaX: Double,
    deltaY: Double,
    symmetric: Bool
  ) -> ViewportFrame {
    let minimumWidth = 320.0
    let minimumHeight = 240.0

    if symmetric {
      let centerX = original.x + original.width / 2
      let centerY = original.y + original.height / 2
      var width = original.width
      var height = original.height

      if affectsLeftEdge {
        width = original.width - (deltaX * 2)
      } else if affectsRightEdge {
        width = original.width + (deltaX * 2)
      }

      if affectsTopEdge {
        height = original.height - (deltaY * 2)
      } else if affectsBottomEdge {
        height = original.height + (deltaY * 2)
      }

      width = max(minimumWidth, width)
      height = max(minimumHeight, height)

      return ViewportFrame(
        x: centerX - width / 2,
        y: centerY - height / 2,
        width: width,
        height: height
      )
    }

    var frame = original
    let rightEdge = original.x + original.width
    let bottomEdge = original.y + original.height

    if affectsLeftEdge {
      frame.x = original.x + deltaX
      frame.width = original.width - deltaX
      if frame.width < minimumWidth {
        frame.width = minimumWidth
        frame.x = rightEdge - minimumWidth
      }
    } else if affectsRightEdge {
      frame.width = max(minimumWidth, original.width + deltaX)
    }

    if affectsTopEdge {
      frame.y = original.y + deltaY
      frame.height = original.height - deltaY
      if frame.height < minimumHeight {
        frame.height = minimumHeight
        frame.y = bottomEdge - minimumHeight
      }
    } else if affectsBottomEdge {
      frame.height = max(minimumHeight, original.height + deltaY)
    }

    return frame
  }
}

struct CanvasHitMap: Equatable {
  var transform: CanvasTransform
  var viewports: [CanvasHitViewport]
  var headerHeight: CGFloat = 46
  var headerTrailingPassthroughWidth: CGFloat = 280
  var edgeHandleThickness: CGFloat = 20
  var edgeHandleLength: CGFloat = 72
  var cornerHandleSize: CGFloat = 24
  var handleOutset: CGFloat = 2

  func frame(for viewportID: UUID) -> ViewportFrame? {
    viewports.first(where: { $0.id == viewportID })?.frame
  }

  func region(at viewportPoint: CGPoint) -> CanvasHitRegion {
    for viewport in viewports.reversed() {
      let viewportRect = CanvasInteractionMath.viewportRect(for: viewport.frame, transform: transform)
      if let handleRegion = handleRegion(at: viewportPoint, viewportID: viewport.id, viewportRect: viewportRect) {
        return handleRegion
      }
      guard viewportRect.contains(viewportPoint) else {
        continue
      }
      if headerDragRect(for: viewportRect).contains(viewportPoint) {
        return .viewportHeader(viewport.id)
      }
      return .viewportPassthrough(viewport.id)
    }

    return .emptyCanvas
  }

  private func handleRegion(at point: CGPoint, viewportID: UUID, viewportRect: CGRect) -> CanvasHitRegion? {
    for handle in ViewportResizeHandle.hitTestOrder {
      if handleRect(for: handle, viewportRect: viewportRect).contains(point) {
        return .viewportHandle(viewportID, handle)
      }
    }
    return nil
  }

  private func headerDragRect(for viewportRect: CGRect) -> CGRect {
    let scale = max(transform.scale, 0.0001)
    let scaledHeaderHeight = min(viewportRect.height, headerHeight * scale)
    let minimumDragWidth = max(140 * scale, viewportRect.width * 0.22)
    let reservedTrailingWidth = min(
      headerTrailingPassthroughWidth * scale,
      max(viewportRect.width - minimumDragWidth, 0)
    )

    return CGRect(
      x: viewportRect.minX,
      y: viewportRect.minY,
      width: max(minimumDragWidth, viewportRect.width - reservedTrailingWidth),
      height: scaledHeaderHeight
    )
  }

  private func handleRect(for handle: ViewportResizeHandle, viewportRect: CGRect) -> CGRect {
    let scale = max(transform.scale, 0.0001)
    let thickness = edgeHandleThickness * scale
    let length = edgeHandleLength * scale
    let corner = cornerHandleSize * scale
    let outset = handleOutset * scale
    let horizontalY = viewportRect.midY - length / 2

    switch handle {
    case .top:
      return CGRect(
        x: viewportRect.midX - length / 2,
        y: viewportRect.minY - thickness / 2 - outset,
        width: length,
        height: thickness
      )
    case .bottom:
      return CGRect(
        x: viewportRect.midX - length / 2,
        y: viewportRect.maxY - thickness / 2 + outset,
        width: length,
        height: thickness
      )
    case .left:
      return CGRect(
        x: viewportRect.minX - thickness / 2 - outset,
        y: horizontalY,
        width: thickness,
        height: length
      )
    case .right:
      return CGRect(
        x: viewportRect.maxX - thickness / 2 + outset,
        y: horizontalY,
        width: thickness,
        height: length
      )
    case .topLeft:
      return CGRect(
        x: viewportRect.minX - corner / 2 - outset,
        y: viewportRect.minY - corner / 2 - outset,
        width: corner,
        height: corner
      )
    case .topRight:
      return CGRect(
        x: viewportRect.maxX - corner / 2 + outset,
        y: viewportRect.minY - corner / 2 - outset,
        width: corner,
        height: corner
      )
    case .bottomLeft:
      return CGRect(
        x: viewportRect.minX - corner / 2 - outset,
        y: viewportRect.maxY - corner / 2 + outset,
        width: corner,
        height: corner
      )
    case .bottomRight:
      return CGRect(
        x: viewportRect.maxX - corner / 2 + outset,
        y: viewportRect.maxY - corner / 2 + outset,
        width: corner,
        height: corner
      )
    }
  }
}

enum CanvasInteractionMath {
  static let minimumCanvasScale: CGFloat = 0.1
  static let maximumCanvasScale: CGFloat = 6.0

  static func visibleCanvasCenter(viewportSize: CGSize, transform: CanvasTransform) -> CGPoint {
    guard viewportSize != .zero else {
      return CGPoint(x: 1600, y: 1200)
    }

    return canvasPoint(
      viewportPoint: CGPoint(x: viewportSize.width / 2, y: viewportSize.height / 2),
      transform: transform
    )
  }

  static func canvasPoint(viewportPoint: CGPoint, transform: CanvasTransform) -> CGPoint {
    let safeScale = max(transform.scale, 0.0001)
    return CGPoint(
      x: (viewportPoint.x - transform.offset.width) / safeScale,
      y: (viewportPoint.y - transform.offset.height) / safeScale
    )
  }

  static func zoomedTransform(
    viewportPoint: CGPoint,
    zoomFactor: CGFloat,
    transform: CanvasTransform,
    minimumScale: CGFloat,
    maximumScale: CGFloat
  ) -> CanvasTransform {
    guard zoomFactor.isFinite, zoomFactor > 0 else {
      return transform
    }

    let currentScale = max(transform.scale, minimumScale)
    let worldPoint = canvasPoint(
      viewportPoint: viewportPoint,
      transform: CanvasTransform(scale: currentScale, offset: transform.offset)
    )
    let nextScale = min(max(currentScale * zoomFactor, minimumScale), maximumScale)

    return CanvasTransform(
      scale: nextScale,
      offset: CGSize(
        width: viewportPoint.x - worldPoint.x * nextScale,
        height: viewportPoint.y - worldPoint.y * nextScale
      )
    )
  }

  static func pannedOffset(origin: CGSize, translation: CGSize) -> CGSize {
    CGSize(
      width: origin.width + translation.width,
      height: origin.height + translation.height
    )
  }

  static func pannedOffset(origin: CGSize, deltaX: CGFloat, deltaY: CGFloat) -> CGSize {
    CGSize(
      width: origin.width + deltaX,
      height: origin.height + deltaY
    )
  }

  static func spawnedViewportFrame(
    center: CGPoint,
    width: Double,
    height: Double,
    staggerIndex: Int
  ) -> ViewportFrame {
    let stagger = Double(staggerIndex) * 44
    return ViewportFrame(
      x: center.x - width / 2 + stagger,
      y: center.y - height / 2 + stagger,
      width: width,
      height: height
    )
  }

  static func viewportRect(for frame: ViewportFrame, transform: CanvasTransform) -> CGRect {
    CGRect(
      x: frame.x * transform.scale + transform.offset.width,
      y: frame.y * transform.scale + transform.offset.height,
      width: frame.width * transform.scale,
      height: frame.height * transform.scale
    )
  }

  static func draggedViewportOrigin(currentCanvasPoint: CGPoint, grabOffset: CGSize) -> CGPoint {
    CGPoint(
      x: currentCanvasPoint.x - grabOffset.width,
      y: currentCanvasPoint.y - grabOffset.height
    )
  }

  static func viewportExclusionRects(frames: [ViewportFrame], transform: CanvasTransform) -> [CGRect] {
    frames.map { viewportRect(for: $0, transform: transform) }
  }
}

private extension ViewportResizeHandle {
  static let hitTestOrder: [ViewportResizeHandle] = [
    .topLeft,
    .topRight,
    .bottomLeft,
    .bottomRight,
    .top,
    .bottom,
    .left,
    .right,
  ]
}
