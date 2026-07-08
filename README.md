# FaceID Davomat — Xodim mobil ilovasi

React Native (Expo, **dev-client**) ilovasi. Xodim GPS geofence ichida turib selfie orqali
davomat (kelish/ketish) qayd etadi, oylik davomat kalendari va maosh hisobini ko'radi.

## Stack

- Expo SDK 53 (dev-client), TypeScript strict, expo-router (file-based)
- TanStack Query v5, Zustand (+ tokenlar `expo-secure-store`da)
- react-hook-form + zod, expo-camera, expo-location, expo-haptics
- react-native-reanimated (spring animatsiyalar, success check)
- **react-native-yamap** (Yandex MapKit — native modul!)
- expo-notifications (push skeleton — `src/lib/notifications.ts`)

## Ekranlar

| Route | Ekran |
|---|---|
| `/login`, `/forgot-password` | Kirish (identifier + parol), parolni tiklash |
| `/(tabs)/` | **Bugun** — status karta, jonli masofa, katta "Ishga keldim / Ishdan ketdim" |
| `/check?type=CHECK_IN\|CHECK_OUT` | Geofence tekshiruv → old kamera (oval ramka) → selfie → natija |
| `/(tabs)/attendance` | Davomat kalendari (oy switcher, kun detali, oy statistikasi) |
| `/(tabs)/payroll` | Oylik (PayrollRecord yoki 403 bo'lsa taxminiy hisob) |
| `/(tabs)/profile` | Profil, filial xaritada, parol almashtirish, til, chiqish |
| `/change-password` | Parol almashtirish |

## Ishga tushirish

```bash
cd mobile
npm install
cp .env.example .env        # qiymatlarni to'ldiring!
```

`.env`:

```
EXPO_PUBLIC_API_URL=http://<KOMPYUTER_LAN_IP>:3000/api/v1
EXPO_PUBLIC_YANDEX_MAPS_API_KEY=<MapKit kaliti>
```

> **MUHIM — LAN IP:** telefon `localhost`ni ko'rmaydi. Backend ishlab turgan
> kompyuterning lokal tarmoq IP sini yozing (`ipconfig` → masalan `192.168.1.42`).
> Telefon va kompyuter bitta Wi-Fi tarmog'ida bo'lishi kerak.

### Native build (dev-client) — MAJBURIY

`react-native-yamap` — native modul, **Expo Go'da ishlamaydi**. Bir marta prebuild +
qurilmaga build qiling:

```bash
npx expo prebuild            # android/ (va ios/) papkalarni generatsiya qiladi
npx expo run:android         # USB orqali ulangan qurilma yoki emulyatorga build
# iOS (faqat macOS): npx expo run:ios
```

Keyingi ishga tushirishlar (native o'zgarmagan bo'lsa):

```bash
npm start                    # expo start --dev-client
```

### Yandex MapKit (yamap) konfiguratsiyasi

- API kalit **runtime'da** beriladi: `src/components/BranchMap.tsx` →
  `YaMap.init(EXPO_PUBLIC_YANDEX_MAPS_API_KEY)`. `app.json`ga kalit yozish shart emas.
- Kalit olish: https://developer.tech.yandex.ru/services → *MapKit Mobile SDK*.
- `app.json`da `newArchEnabled: false` — yamap eski arxitekturada barqaror ishlaydi.
- Xarita komponenti to'liq izolyatsiya qilingan (lazy require + try/catch + ErrorBoundary):
  yamap yo'q muhitda (masalan Expo Go) app qulamaydi, o'rniga
  *"Xarita dev-client talab qiladi"* fallback kartasi chiqadi.

### Typecheck

```bash
npm run typecheck            # tsc --noEmit
```

## Til va tema

Ilova **4 til** va **3 tema rejimini** qo'llab-quvvatlaydi. Tanlov Profil ekranida,
`AsyncStorage`da saqlanadi (`src/store/settings.ts`, Zustand + persist) va ilova qayta
ochilganda tiklanadi.

### Tema (dark / light / system)

- `src/theme/index.ts` — `lightColors` va `darkColors` (bir xil `ColorScheme` tipi;
  dark palitra zinc-950 asosli, `*Dark` variantlari to'q fonda matn uchun yorqinroq).
- **`useTheme()`** hook effektiv temani hisoblaydi: settings `themeMode` +
  OS `useColorScheme()`. `{ colors, isDark, mode }` qaytaradi. Zustand subscription
  tufayli rejim yoki OS temasi o'zgarsa hook ishlatgan komponentlar avtomatik
  re-render bo'ladi.
- Barcha ekran/komponentlar rangga bog'liq stillarni `createStyles(colors)` /
  `useMemo(() => StyleSheet.create(...), [colors])` orqali quradi — tema o'zgarganda
  darhol yangilanadi. StatusBar, tab bar va navigatsiya foni ham temadan.
- `export const colors` (light) — faqat non-React fallback uchun qoldirilgan.

### Til (uz / uz-Cyrl / ru / en)

- Lug'atlar: `src/i18n/uz.ts` (o'zbekcha lotin — **etalon kalitlar**),
  `uz-Cyrl.ts` (krill), `ru.ts` (rus), `en.ts` (ingliz). Har biri
  `satisfies Record<keyof typeof uz, string>` bilan majburlanadi — biror kalit
  yetishmasa yoki ortiqcha bo'lsa `tsc` xato beradi.
- `t(key, vars?)` global `currentLocale` bo'yicha ishlaydi. `currentLocale`
  settings store'ga subscription orqali sinxron turadi (`src/i18n/index.ts`;
  settings.ts i18n'ni faqat type sifatida import qiladi — require cycle yo'q);
  **`app/_layout.tsx`** root `useSettingsStore(s => s.locale)`
  ni kuzatadi — til o'zgarganda butun daraxt qayta render bo'lib barcha `t()`
  chaqiruvlari yangilanadi.

## Push-notification (skeleton)

`src/lib/notifications.ts`da token olish (`registerForPushNotificationsAsync`) va
backendga yuborishga tayyor funksiya (`sendPushTokenToBackend`) bor. Backend'da
push-token endpoint qo'shilganda `app/_layout.tsx`dagi kommentlangan chaqiruvni oching.

## Arxitektura eslatmalar

- `src/lib/api.ts` — envelope unwrap (`success/data/error`) + 401da avtomatik
  refresh-rotation (shared promise, tokenlar secure-store'da). Refresh ham o'tmasa —
  avtomatik logout.
- `src/i18n/` — barcha UI matnlar 4 tilda (`uz`, `uz-Cyrl`, `ru`, `en`). Yangi til:
  `uz.ts` kalitlari asosida lug'at yarating (`satisfies Record<keyof typeof uz, string>`)
  va `src/i18n/index.ts`dagi `dictionaries`ga qo'shing. Til/tema tanlovi — `src/store/settings.ts`.
- Geofence: `expo-location` (high accuracy, jonli watch) + Haversine (`src/lib/geo.ts`),
  Android mock-location flagi (`Location.mocked`) serverga `isMockLocation` sifatida yuboriladi.
# faceid-mobile
