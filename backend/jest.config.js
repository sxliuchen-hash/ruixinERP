module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // 纯函数单测无需连接 DB/Redis；强制退出避免外部句柄悬挂
  forceExit: true,
  clearMocks: true,
  testTimeout: 10000
};
