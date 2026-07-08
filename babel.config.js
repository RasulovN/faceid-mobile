module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // VisionCamera frame processor'lari uchun (react-native-worklets-core).
      // SWM worklets plugin'idan OLDIN turishi kerak.
      'react-native-worklets-core/plugin',
      // Reanimated 4'da worklets plugin alohida paketga ko'chdi; HAR DOIM oxirgi bo'lishi kerak.
      'react-native-worklets/plugin',
    ],
  };
};
