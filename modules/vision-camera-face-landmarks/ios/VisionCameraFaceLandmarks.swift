import Foundation
import VisionCamera
import MediaPipeTasksVision

/**
 * MediaPipe Face Landmarker — vision-camera frame-processor plugin (iOS).
 *
 * Android varianti bilan bir xil natija shakli (JS: FaceLandmarksResult):
 * width/height (upright px), face (normallashgan bbox), blink
 * (eyeBlinkLeft/Right o'rtachasi, -1 noma'lum), landmarks (tekis massiv,
 * har `landmarkStep`-nchi nuqta), unavailable (model yuklanmagan).
 */
@objc(VisionCameraFaceLandmarks)
public class VisionCameraFaceLandmarks: FrameProcessorPlugin {
  private var landmarker: FaceLandmarker?
  private var lastTimestampMs = 0

  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]! = [:]) {
    super.init(proxy: proxy, options: options)
    // GPU delegate ishlamasa CPU'ga tushamiz (kiosk faceDetect.ts bilan bir xil)
    landmarker = Self.createLandmarker(delegate: .gpu) ?? Self.createLandmarker(delegate: .cpu)
    if landmarker == nil {
      print("[FaceLandmarks] FaceLandmarker yaratib bo'lmadi — model bundle'da yo'qmi?")
    }
  }

  private static func modelPath() -> String? {
    // Statik pod'da resurslar asosiy bundle'ga ko'chiriladi; har ehtimolga
    // qarshi avval klass bundle'ini ham tekshiramiz.
    let classBundle = Bundle(for: VisionCameraFaceLandmarks.self)
    if let path = classBundle.path(forResource: "face_landmarker", ofType: "task") {
      return path
    }
    return Bundle.main.path(forResource: "face_landmarker", ofType: "task")
  }

  private static func createLandmarker(delegate: Delegate) -> FaceLandmarker? {
    guard let modelPath = modelPath() else { return nil }
    let options = FaceLandmarkerOptions()
    options.baseOptions.modelAssetPath = modelPath
    options.baseOptions.delegate = delegate
    options.runningMode = .video
    options.numFaces = 1
    options.outputFaceBlendshapes = true
    return try? FaceLandmarker(options: options)
  }

  /// MediaPipe mirrored orientatsiyalarni qo'llamaydi — asosiysiga keltiramiz.
  /// Ko'zgu aksi blink o'rtachasiga ta'sir qilmaydi (chap/o'ng almashadi xolos).
  private func normalizedOrientation(_ orientation: UIImage.Orientation) -> UIImage.Orientation {
    switch orientation {
    case .upMirrored: return .up
    case .downMirrored: return .down
    case .leftMirrored: return .left
    case .rightMirrored: return .right
    default: return orientation
    }
  }

  public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
    var out = [String: Any]()
    guard let landmarker = landmarker else {
      out["unavailable"] = true
      return out
    }

    let orientation = normalizedOrientation(frame.orientation)
    // Sensor bufferi landscape — 90° orientatsiyalarda upright o'lchamlar almashadi
    let isRotated = orientation == .left || orientation == .right
    out["width"] = isRotated ? Int(frame.height) : Int(frame.width)
    out["height"] = isRotated ? Int(frame.width) : Int(frame.height)

    guard let image = try? MPImage(sampleBuffer: frame.buffer, orientation: orientation) else {
      return out
    }

    // detect(videoFrame:) timestamp'lari qat'iy o'sib borishi shart
    var ts = Int(DispatchTime.now().uptimeNanoseconds / 1_000_000)
    if ts <= lastTimestampMs { ts = lastTimestampMs + 1 }
    lastTimestampMs = ts

    guard let result = try? landmarker.detect(videoFrame: image, timestampInMilliseconds: ts),
          let mesh = result.faceLandmarks.first, !mesh.isEmpty else {
      return out
    }

    let step = max((arguments?["landmarkStep"] as? Int) ?? 4, 1)
    var minX: Float = 1, minY: Float = 1, maxX: Float = 0, maxY: Float = 0
    var points = [Double]()
    points.reserveCapacity((mesh.count / step + 1) * 2)
    for (i, landmark) in mesh.enumerated() {
      let x = landmark.x
      let y = landmark.y
      if x < minX { minX = x }
      if x > maxX { maxX = x }
      if y < minY { minY = y }
      if y > maxY { maxY = y }
      if i % step == 0 {
        points.append(Double(x))
        points.append(Double(y))
      }
    }
    out["face"] = [
      "x": Double(minX),
      "y": Double(minY),
      "width": Double(maxX - minX),
      "height": Double(maxY - minY),
    ]
    out["landmarks"] = points

    var blink = -1.0
    if let categories = result.faceBlendshapes.first?.categories {
      var left = 0.0
      var right = 0.0
      for category in categories {
        if category.categoryName == "eyeBlinkLeft" {
          left = Double(category.score)
        } else if category.categoryName == "eyeBlinkRight" {
          right = Double(category.score)
        }
      }
      blink = (left + right) / 2.0
    }
    out["blink"] = blink
    return out
  }
}
