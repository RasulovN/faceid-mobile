/**
 * MediaPipe Face Landmarker modelini (face_landmarker.task, ~3.7 MB) yuklab,
 * lokal vision-camera-face-landmarks plugin paketiga joylaydi:
 *   - Android: modules/.../android/src/main/assets → APK assets'ga birlashadi
 *   - iOS: modules/.../ios/assets → podspec `resources` orqali app bundle'ga
 *
 * Kioskdagi client/scripts/setup-models.mjs bilan bir xil model va URL.
 * Qo'lda ishga tushirish: `npm run setup-models`
 * (postinstall hook sifatida ham avtomatik ishlaydi — EAS build'da ham)
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const moduleDir = path.resolve(__dirname, "..", "modules", "vision-camera-face-landmarks");

const MODEL_FILE = "face_landmarker.task";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const TARGETS = [
  path.join(moduleDir, "android", "src", "main", "assets", MODEL_FILE),
  path.join(moduleDir, "ios", "assets", MODEL_FILE),
];

async function main() {
  const missing = TARGETS.filter(
    (t) => !fs.existsSync(t) || fs.statSync(t).size < 1_000_000
  );
  if (missing.length === 0) {
    console.log("[setup-face-landmarker] face_landmarker.task allaqachon joyida.");
    return;
  }
  try {
    process.stdout.write(`  ⇣ ${MODEL_FILE} ... `);
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`${MODEL_URL} → HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    for (const target of missing) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buf);
    }
    console.log(`OK (${(buf.length / 1024 / 1024).toFixed(1)} MB, ${missing.length} joyga)`);
  } catch (err) {
    console.warn(
      `[setup-face-landmarker] OGOHLANTIRISH: modelni yuklab bo'lmadi (${err.message}).\n` +
        "  Internet paydo bo'lganda `npm run setup-models` ni qayta ishga tushiring.\n" +
        "  DIQQAT: modelsiz build'da MediaPipe rejimi ishlamaydi (MLKit fallback ishlaydi)."
    );
    // postinstall'ni yiqitmaymiz — dev keyinroq qayta urinishi mumkin
    process.exitCode = 0;
  }
}

main();
