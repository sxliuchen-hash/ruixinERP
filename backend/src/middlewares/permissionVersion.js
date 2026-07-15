'use strict';

const mainPermissionVersionService = require('../services/mainPermissionVersionService');

function requireCurrentPermissionVersion({ realtime = false } = {}) {
  return async (req, res, next) => {
    try {
      await mainPermissionVersionService.assertCurrentPermissionVersion(req.user, {
        forceRefresh: realtime
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireFreshPermissionVersion() {
  return requireCurrentPermissionVersion({ realtime: true });
}

module.exports = {
  requireCurrentPermissionVersion,
  requireFreshPermissionVersion
};
