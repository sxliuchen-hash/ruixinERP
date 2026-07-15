'use strict';

const mainSsoService = require('../services/mainSsoService');
const ssoStateService = require('../services/ssoStateService');
const { getMainSsoConfig, assertMainSsoInitiationConfig } = require('../config/mainSso');
const { isSsoLoginEnabled } = require('../config/authFeatures');
const { AppError, ValidationError } = require('../utils/errors');
const { isValidOpaqueToken } = require('../services/ssoStateService');

function readCookie(cookieHeader, cookieName) {
  if (typeof cookieHeader !== 'string' || !cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 1) continue;
    const name = part.slice(0, separatorIndex).trim();
    if (name === cookieName) return part.slice(separatorIndex + 1).trim();
  }
  return '';
}

function stateCookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.stateCookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: config.stateTtlSec * 1000
  };
}

async function initiate(req, res, next) {
  try {
    if (!isSsoLoginEnabled()) {
      throw new AppError('主项目单点登录尚未启用', 503, 'SSO_LOGIN_DISABLED');
    }

    const config = getMainSsoConfig();
    assertMainSsoInitiationConfig(config);
    const currentBinding = readCookie(req.headers?.cookie, config.stateCookieName);
    const initiation = await ssoStateService.create({
      browserBinding: currentBinding,
      redirect: req.body?.redirect
    });
    const continueUrl = new URL(config.continuePath, config.mainSystemUrl);
    continueUrl.searchParams.set('app', 'erp');
    continueUrl.searchParams.set('state', initiation.state);

    res.cookie(
      config.stateCookieName,
      initiation.browserBinding,
      stateCookieOptions(config)
    );
    res.json({
      success: true,
      data: {
        state: initiation.state,
        redirectUrl: continueUrl.toString(),
        continueUrl: continueUrl.toString(),
        expiresIn: initiation.expiresIn
      }
    });
  } catch (error) {
    next(error);
  }
}

async function exchange(req, res, next) {
  try {
    const code = req.body?.code;
    const state = req.body?.state;
    if (!isValidOpaqueToken(code)) {
      throw new ValidationError('单点登录授权码格式错误');
    }
    if (typeof state !== 'string' || !state.trim()) {
      throw new AppError('SSO 回调缺少 state', 400, 'SSO_STATE_MISSING');
    }

    const config = getMainSsoConfig();
    const browserBinding = readCookie(req.headers?.cookie, config.stateCookieName);
    const stateData = await ssoStateService.consume({
      state: state.trim(),
      browserBinding
    });
    const result = await mainSsoService.exchangeCode(code.trim(), state.trim());
    res.json({
      success: true,
      message: '登录成功',
      data: {
        ...result,
        ...(stateData.redirect && { redirect: stateData.redirect })
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  initiate,
  exchange,
  readCookie,
  stateCookieOptions
};
