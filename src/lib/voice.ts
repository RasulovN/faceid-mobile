/**
 * Ovozli e'lon — ikki bosqichli strategiya:
 *   1. `assets/audio/<til>/` da tayyor yozilgan audio fayl bo'lsa — o'shani
 *      o'ynatadi (masalan `assets/audio/uz/kirish-qayd-etildi.mp3`).
 *   2. Fayl bo'lmasa (yoki o'ynatishda xato) — avvalgidek TTS (expo-speech)
 *      bilan aytadi, u ham bo'lmasa jimgina o'tadi.
 *
 * Fayllar `require.context` orqali build vaqtida avtomatik topiladi — papka
 * bo'sh bo'lsa ham build buzilmaydi, yangi fayl qo'shilganda kod o'zgarmaydi
 * (faqat qayta build kerak, chunki asset bundle'ga kiradi).
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';

import type { Locale } from '@/i18n';

export type VoiceKey =
  | 'checkIn'
  | 'checkOut'
  | 'notRecognized'
  | 'livenessFailed'
  | 'subscriptionExpired';

const FILE_BASES: Record<VoiceKey, string> = {
  checkIn: 'kirish-qayd-etildi',
  checkOut: 'chiqish-qayd-etildi',
  notRecognized: 'yuz-tanilmadi',
  livenessFailed: 'jonlilik-otmadi',
  subscriptionExpired: 'obuna-toxtatilgan',
};

/** Qo'llab-quvvatlanadigan kengaytmalar — birinchi topilgani o'ynatiladi. */
const EXTENSIONS = ['.mp3', '.wav', '.m4a'];

// assets/audio ichidagi barcha audio fayllar: ./uz/x.wav, ./ru/x.mp3 yoki ./x.mp3
const audioContext = require.context('../../assets/audio', true, /\.(mp3|wav|m4a)$/);

/** Locale'ni TTS/audio til kodiga moslaydi (uz-Cyrl uchun 'uz' fallback). */
function speechLang(locale: Locale): string {
  switch (locale) {
    case 'ru':
      return 'ru';
    case 'en':
      return 'en';
    default:
      return 'uz';
  }
}

/**
 * Til papkasidan qidiradi (`./uz/fayl.wav`); o'zbek tili uchun ildizga
 * tashlangan fayl ham qabul qilinadi (`./fayl.wav`).
 */
function findAsset(key: VoiceKey, lang: string): number | null {
  const keys = audioContext.keys();
  for (const ext of EXTENSIONS) {
    const name = FILE_BASES[key] + ext;
    const inLang = `./${lang}/${name}`;
    if (keys.includes(inLang)) return audioContext<number>(inLang);
    if (lang === 'uz' && keys.includes(`./${name}`)) {
      return audioContext<number>(`./${name}`);
    }
  }
  return null;
}

let audioModeSet = false;
let current: AudioPlayer | null = null;

/**
 * Ovozli e'lon — faqat terminal (bir martalik) holatlarda chaqiriladi.
 * Mos audio fayl bo'lsa uni o'ynatadi, bo'lmasa `text`ni TTS bilan aytadi.
 */
export function announce(key: VoiceKey, text: string, locale: Locale): void {
  const lang = speechLang(locale);
  const asset = findAsset(key, lang);
  if (asset !== null) {
    try {
      if (!audioModeSet) {
        audioModeSet = true;
        // iOS "silent" tumbleri yoqiq bo'lsa ham e'lon eshitilsin.
        void setAudioModeAsync({ playsInSilentMode: true });
      }
      Speech.stop();
      // Oldingi e'lon hali o'ynayotgan bo'lsa to'xtatib resursini bo'shatamiz.
      current?.remove();
      current = createAudioPlayer(asset);
      current.play();
      return;
    } catch {
      /* audio o'ynamadi — quyida TTS'ga o'tamiz */
    }
  }
  try {
    Speech.stop();
    Speech.speak(text, { language: lang });
  } catch {
    /* ovoz mavjud emas — jim */
  }
}
