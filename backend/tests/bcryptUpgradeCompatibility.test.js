'use strict';

const bcrypt = require('bcrypt');

// 由 bcrypt 5.1.1 使用固定 $2b$ salt 生成。升级原生绑定后必须继续兼容
// 主项目 users.password 中已经持久化的历史哈希。
const LEGACY_BCRYPT_5_HASH =
  '$2b$10$abcdefghijklmnopqrstuuHYJfdoZXxSXE7RLW0kixQXIUwDFSkrK';

describe('bcrypt 6 历史密码哈希兼容性', () => {
  test('旧 $2b$ 哈希对正确密码返回 true、错误密码返回 false', async () => {
    await expect(
      bcrypt.compare('upgrade-smoke-password', LEGACY_BCRYPT_5_HASH)
    ).resolves.toBe(true);
    await expect(
      bcrypt.compare('wrong-password', LEGACY_BCRYPT_5_HASH)
    ).resolves.toBe(false);
  });
});
