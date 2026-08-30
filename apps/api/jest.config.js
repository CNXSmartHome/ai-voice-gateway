/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  // Resolve workspace packages to their TypeScript sources. Without this the
  // package `main` points at `dist/`, so tests would depend on build order --
  // which broke in CI, where tests run before the build.
  moduleNameMapper: {
    '^@vg/domain$': '<rootDir>/../../packages/domain/src/index.ts',
  },
  collectCoverageFrom: ['src/**/*.ts'],
};
