# Brend assetlari — almashtirish yo'riqnomasi

Bu papkadagi SVG'lar **placeholder masterlar**. Haqiqiy logo tayyor bo'lganda
quyidagilarni almashtirasiz:

## 1. SVG masterlar (shu papka — dizayn manbai)

| Fayl | Nima |
|---|---|
| `logo.svg` | Yalang'och glif (indigo, shaffof fon) |
| `logo-mark.svg` | Ilova ikonkasi uslubi: indigo plitka + oq glif |
| `logo-full.svg` | Gorizontal lockup: belgi + "FaceID Davomat" yozuvi |

## 2. Ilova icon/splash PNG'lari (`mobile/assets/` — build shularni oladi)

Yangi logodan quyidagi PNG'larni eksport qilib, **xuddi shu nomlar bilan** almashtiring
(app.json'ga tegilmaydi):

| Fayl | O'lcham | Talab |
|---|---|---|
| `icon.png` | 1024×1024 | Shaffoflik YO'Q (to'liq fon) — iOS/App Store |
| `adaptive-icon.png` | 1024×1024 | Faqat glif, shaffof fon; kontent markazdagi ~60% doira ichida (Android kesadi) |
| `splash-icon.png` | 512×512+ | Glif, shaffof fon (fon rangi app.json'da: #4F46E5) |
| `notification-icon.png` | 96×96 | FAQAT oq + shaffoflik (Android talabi, rangli bo'lsa oq kvadrat ko'rinadi) |

## 3. Ilova ICHIDAGI logo (login ekrani va h.k.)

`src/components/BrandLogo.tsx` — glif sof React Native View'lar bilan chizilgan
(react-native-svg O'RNATILMAGAN — native modul qo'shish dev-client rebuild talab qiladi).
Haqiqiy logoga o'tishda ikki yo'l bor:

- **Oson:** logoni PNG qilib (masalan `assets/brand/logo.png` @2x/@3x bilan) `<Image>`
  orqali ko'rsatish — `BrandLogo` ichini `<Image source={require(...)} />` ga almashtirasiz.
- **Sifatli (vektor):** `npx expo install react-native-svg` + dev-client REBUILD, so'ng
  SVG'ni `react-native-svg` komponentiga aylantirish (transformer yoki qo'lda).

Ranglar: indigo `#4F46E5` (docs/DESIGN_SYSTEM.md dagi asosiy accent).
