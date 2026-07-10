# Mobil ovozli e'lon fayllari

Audio fayllarni (`.mp3`, `.wav` yoki `.m4a`) til papkasiga qo'ying: `uz/`
(o'zbekcha; uz-Cyrl ham shuni oladi), xohlasangiz `ru/`, `en/` papkalarini ham
xuddi shu fayl nomlari bilan to'ldiring. Fayl bo'lmasa ilova avvalgidek TTS
(expo-speech) bilan gapiraveradi.

**Muhim:** fayl qo'shilgach ilovani qayta build qilish kerak (asset bundle'ga kiradi).

| Fayl nomi | Aytiladigan matn (uz) | Holat |
|-----------|----------------------|-------|
| `kirish-qayd-etildi.*` | Kirish qayd etildi | Yuz tasdiqlandi, kirish |
| `chiqish-qayd-etildi.*` | Chiqish qayd etildi | Yuz tasdiqlandi, chiqish |
| `yuz-tanilmadi.*` | Yuz tanilmadi | Yuz boshqa odamniki |
| `jonlilik-otmadi.*` | Jonlilik tekshiruvi o'tmadi | Spoof gumoni |
| `obuna-toxtatilgan.*` | Obuna to'xtatilgan | Kompaniya obunasi tugagan |

Kod: `src/lib/voice.ts`
