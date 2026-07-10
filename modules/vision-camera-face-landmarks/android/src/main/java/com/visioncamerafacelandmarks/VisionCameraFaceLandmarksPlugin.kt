package com.visioncamerafacelandmarks

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.VisionCameraProxy

private const val TAG = "FaceLandmarks"

/** Modul android assets'iga qo'shilgan model (setup-face-landmarker.mjs yuklaydi). */
private const val MODEL_ASSET = "face_landmarker.task"

/**
 * MediaPipe Face Landmarker — vision-camera frame-processor plugin.
 *
 * Kioskdagi client/src/modules/kiosk/lib/faceDetect.ts bilan bir xil model va
 * bir xil semantika: har kadrda 478 nuqtali mesh + `eyeBlinkLeft/Right`
 * blendshape skorlari. Skor ko'z holatini maxsus o'qitilgan modeldan oladi —
 * statik rasm/ekran uni "yumuq" qilolmaydi, shu sabab blink jonlilik dalili
 * sifatida ishonchli.
 *
 * Qaytaradigan qiymat (JS: FaceLandmarksResult):
 *   width/height — upright (portret) kadr o'lchamlari, px
 *   face         — normallashgan (0..1) yuz to'rtburchagi (mesh chegarasi)
 *   blink        — eyeBlinkLeft/Right o'rtachasi (0 ochiq..1 yumuq), -1 noma'lum
 *   landmarks    — tekis massiv [x0,y0,x1,y1,...], normallashgan, har
 *                  `landmarkStep`-nchi nuqta (overlay uchun yetarli)
 *   unavailable  — model yuklanmagan bo'lsa true (JS fallback'ga o'tadi)
 */
class VisionCameraFaceLandmarksPlugin(
  proxy: VisionCameraProxy,
  @Suppress("UNUSED_PARAMETER") options: Map<String, Any>?
) : FrameProcessorPlugin() {
  private var landmarker: FaceLandmarker? = null
  private var lastTimestampMs = 0L

  init {
    val context = proxy.context
    landmarker = try {
      createLandmarker(context, Delegate.GPU)
    } catch (gpuError: Throwable) {
      // GPU delegate ishlamasa (eski qurilma/driver) — CPU'ga tushamiz (kiosk kabi)
      Log.w(TAG, "GPU delegate ishlamadi, CPU'ga o'tilmoqda", gpuError)
      try {
        createLandmarker(context, Delegate.CPU)
      } catch (cpuError: Throwable) {
        Log.e(TAG, "FaceLandmarker yaratib bo'lmadi", cpuError)
        null
      }
    }
  }

  private fun createLandmarker(context: Context, delegate: Delegate): FaceLandmarker {
    val baseOptions = BaseOptions.builder()
      .setModelAssetPath(MODEL_ASSET)
      .setDelegate(delegate)
      .build()
    val options = FaceLandmarker.FaceLandmarkerOptions.builder()
      .setBaseOptions(baseOptions)
      .setRunningMode(RunningMode.VIDEO)
      .setNumFaces(1)
      .setOutputFaceBlendshapes(true)
      .build()
    return FaceLandmarker.createFromOptions(context, options)
  }

  override fun callback(frame: Frame, params: Map<String, Any>?): Any {
    val out = HashMap<String, Any>()
    val detector = landmarker
    if (detector == null) {
      out["unavailable"] = true
      return out
    }
    try {
      val imageProxy = frame.imageProxy
      val rotationDegrees = imageProxy.imageInfo.rotationDegrees

      // YUV kadr → ARGB bitmap (libyuv orqali, tez), keyin upright'ga burish.
      // MediaPipe blendshape modeli taxminan tik yuz kutadi — burish shart.
      var bitmap: Bitmap = imageProxy.toBitmap()
      if (rotationDegrees != 0) {
        val matrix = Matrix()
        matrix.postRotate(rotationDegrees.toFloat())
        bitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, false)
      }
      out["width"] = bitmap.width
      out["height"] = bitmap.height

      // detectForVideo timestamp'lari qat'iy o'sib borishi shart
      var ts = SystemClock.uptimeMillis()
      if (ts <= lastTimestampMs) ts = lastTimestampMs + 1
      lastTimestampMs = ts

      val result = detector.detectForVideo(BitmapImageBuilder(bitmap).build(), ts)
      val meshes = result.faceLandmarks()
      if (meshes.isNullOrEmpty() || meshes[0].isEmpty()) return out

      val mesh = meshes[0]
      val step = ((params?.get("landmarkStep") as? Number)?.toInt() ?: 4).coerceAtLeast(1)
      var minX = 1f; var minY = 1f; var maxX = 0f; var maxY = 0f
      val points = ArrayList<Double>((mesh.size / step + 1) * 2)
      for ((i, p) in mesh.withIndex()) {
        val x = p.x(); val y = p.y()
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (i % step == 0) {
          points.add(x.toDouble())
          points.add(y.toDouble())
        }
      }
      out["face"] = hashMapOf(
        "x" to minX.toDouble(),
        "y" to minY.toDouble(),
        "width" to (maxX - minX).toDouble(),
        "height" to (maxY - minY).toDouble()
      )
      out["landmarks"] = points

      var blink = -1.0
      val blendshapes = result.faceBlendshapes()
      if (blendshapes.isPresent && blendshapes.get().isNotEmpty()) {
        var left = 0.0; var right = 0.0
        for (category in blendshapes.get()[0]) {
          when (category.categoryName()) {
            "eyeBlinkLeft" -> left = category.score().toDouble()
            "eyeBlinkRight" -> right = category.score().toDouble()
          }
        }
        blink = (left + right) / 2.0
      }
      out["blink"] = blink
    } catch (e: Throwable) {
      // Kadr yopilib qolgan/vaqtinchalik xato — bo'sh natija, sikl davom etadi
      Log.e(TAG, "Kadr tahlili xatosi", e)
    }
    return out
  }
}
