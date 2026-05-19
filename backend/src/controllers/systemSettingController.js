/**
 * ============================================================
 * 系统设置 Controller
 * ============================================================
 * 提供 key-value 配置的 CRUD 接口
 * 仅管理员可写入
 * ============================================================
 */

const systemSettingService = require('../services/systemSettingService');

/** GET /api/v1/system-settings - 列表 */
async function getList(req, res, next) {
  try {
    const { category } = req.query;
    const data = await systemSettingService.list(category);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/system-settings/:key - 获取单个配置值 */
async function getValue(req, res, next) {
  try {
    const { key } = req.params;
    const value = await systemSettingService.get(key);
    res.json({ success: true, data: { key, value } });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/system-settings/:key - 更新或新建配置（仅管理员） */
async function setValue(req, res, next) {
  try {
    const { key } = req.params;
    const { value, description, category } = req.body;
    const userId = req.user.id;
    const data = await systemSettingService.set(key, value, description, category, userId);
    res.json({ success: true, message: '已保存', data });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/v1/system-settings/:key - 删除配置（仅管理员） */
async function deleteValue(req, res, next) {
  try {
    const { key } = req.params;
    const data = await systemSettingService.delete(key);
    res.json({ success: true, message: '已删除', data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getList,
  getValue,
  setValue,
  deleteValue
};
