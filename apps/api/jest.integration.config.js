/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.integration-spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  // See jest.config.js: keeps tests independent of build order.
  moduleNameMapper: {
    '^@vg/domain$': '<rootDir>/../../packages/domain/src/index.ts',
  },
  testTimeout: 30000,
};
