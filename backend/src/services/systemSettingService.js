/**
 * ============================================================
 * 系统设置服务（SystemSettingService）
 * ============================================================
 *
 * 【职责】
 *   1) 提供按 key 读写系统配置的便捷方法
 *   2) 内存缓存（30s）减少数据库查询
 *   3) 提供专项 helper（如 channelSalesCost.getByPatentType）
 *
 * 【常用配置】
 *   - channel_sales_cost  渠道销售成本（按专利类型）
 * ============================================================
 */

const SystemSetting = require('../models/SystemSetting');
const { ValidationError, NotFoundError } = require('../utils/errors');

const CACHE_TTL_MS = 30 * 1000; // 30 秒
const cache = new Map(); // key -> { value, expireAt }

class SystemSettingService {
  /**
   * 获取设置项（带缓存）
   * @param {string} key
   * @param {*} defaultValue 默认值
   */
  async get(key, defaultValue = null) {
    // 先查缓存
    const cached = cache.get(key);
    if (cached && cached.expireAt > Date.now()) {
      return cached.value;
    }

    const setting = await SystemSetting.findOne({ where: { setting_key: key } });
    const value = setting ? setting.setting_value : defaultValue;

    cache.set(key, { value, expireAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  /**
   * 设置/更新配置项（仅管理员调用）
   */
  async set(key, value, description, category, userId) {
    if (!key) throw new ValidationError('key 不能为空');
    if (value === undefined) throw new ValidationError('value 不能为空');

    const [record] = await SystemSetting.upsert({
      setting_key: key,
      setting_value: value,
      description: description || null,
      category: category || 'general',
      updated_by: userId || null
    });

    // 失效缓存
    cache.delete(key);
    return record;
  }

  /**
   * 列出所有设置（按分类）
   */
  async list(category) {
    const where = category ? { category } : {};
    return await SystemSetting.findAll({
      where,
      order: [['category', 'ASC'], ['setting_key', 'ASC']]
    });
  }

  /**
   * 删除某个设置项
   */
  async delete(key) {
    const count = await SystemSetting.destroy({ where: { setting_key: key } });
    if (!count) throw new NotFoundError('设置项不存在');
    cache.delete(key);
    return { deleted: count };
  }

  /**
   * 强制清空缓存（测试用）
   */
  clearCache() {
    cache.clear();
  }

  // ==================== 专项 Helper ====================

  /**
   * 获取某专利类型的渠道销售成本
   *
   * @param {string} patentType - 专利类型（发明/实用新型/外观）
   * @returns {Promise<number>} 销售成本金额
   */
  async getChannelSalesCost(patentType) {
    const config = await this.get('channel_sales_cost', {
      '发明': 1000,
      '实用新型': 200,
      '外观': 200,
      'default': 500
    });

    if (!patentType) return config.default || 0;

    // 直接匹配
    if (config[patentType] !== undefined) {
      return parseFloat(config[patentType]) || 0;
    }

    // 模糊匹配（"发明专利" → "发明"）
    for (const [key, value] of Object.entries(config)) {
      if (key === 'default') continue;
      if (patentType.includes(key) || key.includes(patentType)) {
        return parseFloat(value) || 0;
      }
    }

    return parseFloat(config.default) || 0;
  }
}

module.exports = new SystemSettingService();
