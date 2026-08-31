/**
 * Reads the build-time environment.
 *
 * `process.env.EXPO_PUBLIC_API_URL` is written out in full on purpose:
 * `babel-preset-expo` substitutes that exact expression for a literal when it
 * builds the bundle. Reading it through a variable, a computed key, or a
 * spread of `process.env` is not matched, and yields `undefined` in a release
 * build while working perfectly in development -- which is the worst possible
 * place for this to go wrong.
 */
export function readEnvironment(): Record<string, string | undefined> {
  return { EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL };
}
