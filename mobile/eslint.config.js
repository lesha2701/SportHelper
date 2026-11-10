// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*'],
  },
  {
    rules: {
      // Intentional patterns here: a text field that follows its value except while it is being typed in,
      // a wall-clock rest timer, loaders that take their own dependency list. The compiler-oriented rules below flag
      // them although they are correct and covered by tests and by running the screens.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/use-memo': 'off',
    },
  },
]);
