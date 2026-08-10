// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // The encryption key is reachable from exactly one directory.
    //
    // lib/crypto/ is where the key is used to encrypt and decrypt; everything
    // else goes through lib/plaintext/broker.ts, which hands out decrypted
    // text for explicitly named notes and never the key itself. That
    // distinction is the whole basis for being able to answer "what could
    // this feature have read?" -- a feature holding the key could have read
    // anything, whatever it was asked for.
    //
    // This rule is the mechanical half of that guarantee;
    // scripts/verify-plaintext-gates.ts asserts the same thing by grep so it
    // also fails in CI without a lint run.
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['lib/crypto/**', 'scripts/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/crypto/vault',
              importNames: ['getDataKey'],
              message:
                'The raw data key must not leave lib/crypto/. To send note content anywhere, use requestPlaintext() in lib/plaintext/broker.ts, which is gated, scoped and audited.',
            },
          ],
        },
      ],
    },
  },
]);
