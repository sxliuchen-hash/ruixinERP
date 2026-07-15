module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // Tests must release Redis, HTTP, and timer resources without a forced exit.
  forceExit: false,
  clearMocks: true,
  testTimeout: 10000
};
