/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  rootDir: ".",
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)",
  ],
};
