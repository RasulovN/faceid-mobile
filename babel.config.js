module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Reanimated 4'da worklets plugin alohida paketga ko'chdi; HAR DOIM oxirgi bo'lishi kerak.
      'react-native-worklets/plugin',
    ],
  };
};
