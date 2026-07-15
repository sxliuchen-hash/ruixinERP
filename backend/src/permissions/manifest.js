'use strict';

const crypto = require('crypto');
const manifest = require('./erp-permission-manifest.json');

function getPermissionManifest() {
  const serialized = JSON.stringify(manifest);
  return {
    ...manifest,
    hash: crypto.createHash('sha256').update(serialized).digest('hex')
  };
}

module.exports = {
  getPermissionManifest
};
