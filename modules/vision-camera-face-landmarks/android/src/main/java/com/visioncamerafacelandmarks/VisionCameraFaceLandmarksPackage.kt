package com.visioncamerafacelandmarks

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry

/**
 * Frame-processor pluginni ro'yxatga oladi. NativeModule/ViewManager yo'q —
 * JS unga VisionCameraProxy.initFrameProcessorPlugin('detectFaceLandmarks')
 * orqali murojaat qiladi. Ro'yxatga olish companion init'da: PackageList bu
 * klassni ilova startida yuklaydi (vision-camera-face-detector bilan bir xil
 * pattern).
 */
class VisionCameraFaceLandmarksPackage : ReactPackage {
  companion object {
    init {
      FrameProcessorPluginRegistry.addFrameProcessorPlugin("detectFaceLandmarks") { proxy, options ->
        VisionCameraFaceLandmarksPlugin(proxy, options)
      }
    }
  }

  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = emptyList()

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
