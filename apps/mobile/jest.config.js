/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  // `.ts` only, and no React Native transform. Everything worth asserting --
  // request shapes, error mapping, token storage, sign-in state -- is plain
  // TypeScript with its dependencies injected, so the tests need neither a
  // native module nor a renderer. The `.tsx` files are thin bindings over it.
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  collectCoverageFrom: ['src/**/*.ts'],
};
