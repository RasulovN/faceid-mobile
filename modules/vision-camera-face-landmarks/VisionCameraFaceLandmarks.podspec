require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "VisionCameraFaceLandmarks"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://timepro.uz"
  s.license      = "MIT"
  s.authors      = "ATS"

  # Expo SDK 54 minimal iOS versiyasi
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/ats-systems/faceid.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  # face_landmarker.task modeli app bundle'ga ko'chiriladi
  # (scripts/setup-face-landmarker.mjs postinstall'da yuklab qo'yadi)
  s.resources    = "ios/assets/*.task"

  s.dependency "React-Core"
  s.dependency "VisionCamera"
  s.dependency "MediaPipeTasksVision", "~> 0.10.21"
end
