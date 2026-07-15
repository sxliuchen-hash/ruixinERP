'use strict';

function readBooleanEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;

  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function isSsoLoginEnabled() {
  return readBooleanEnv('ENABLE_SSO_LOGIN', false);
}

function isPasswordLoginEnabled() {
  return readBooleanEnv('ENABLE_PASSWORD_LOGIN', true);
}

function isLegacySessionEnabled() {
  return readBooleanEnv('ENABLE_LEGACY_SESSION', true);
}

/**
 * 主项目数据库仅为旧密码登录和存量 legacy 会话服务。
 * 全量 SSO 后这两个开关都关闭，ERP 启动和正常业务不应再建立主库连接。
 */
function shouldConnectMainDatabase() {
  // 密码登录只有在 legacy 会话同时开启时才可用；若出现 password=true、
  // legacy=false 的错误组合，认证服务会拒绝登录，启动也不应为无效路径连主库。
  return isLegacySessionEnabled();
}

function getMainSystemUrl() {
  const configured = String(process.env.MAIN_SYSTEM_URL || '').trim();
  if (!configured) return '';
  try {
    const url = new URL(configured);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch (_error) {
    return '';
  }
}

function getAuthFeatures() {
  return {
    // 密码登录签发的是 legacy 会话；任一开关关闭时都不能向前端展示可用入口。
    passwordLoginEnabled: isPasswordLoginEnabled() && isLegacySessionEnabled(),
    ssoLoginEnabled: isSsoLoginEnabled(),
    mainSystemUrl: getMainSystemUrl()
  };
}

module.exports = {
  readBooleanEnv,
  isSsoLoginEnabled,
  isPasswordLoginEnabled,
  isLegacySessionEnabled,
  shouldConnectMainDatabase,
  getMainSystemUrl,
  getAuthFeatures
};
