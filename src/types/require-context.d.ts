/**
 * Metro bundler'ning `require.context` API'si uchun tip deklaratsiyasi.
 * Runtime'da Metro beradi (expo/metro-runtime), lekin NodeRequire tipida
 * yo'qligi uchun typecheck yiqilardi (qarang: src/lib/voice.ts).
 */
interface MetroRequireContext {
  keys(): string[];
  <T = unknown>(id: string): T;
}

interface NodeRequire {
  context(
    directory: string,
    useSubdirectories?: boolean,
    regExp?: RegExp,
  ): MetroRequireContext;
}
