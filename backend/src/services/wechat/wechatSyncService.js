/**
 * ============================================================
 * 企微审批同步服务（WechatSyncService）
 * ============================================================
 * 职责：
 *   1) 接收回调事件，解析审批单号
 *   2) 拉取审批详情，按模板类型分发处理
 *   3) 字段映射 → 写入 ERP 业务表（合同/收付款）
 *   4) 幂等去重（sp_no 唯一约束）
 *
 * 支持的模板：
 *   - 合同审批 → contracts 表
 *   - 付款     → payments 表
 *
 * 【同步策略】
 *   - 仅同步 sp_status=2（已通过）的审批单
 *   - sp_no 做幂等键，重复推送不会重复创建
 *   - 名称匹配客户/供应商/账户，匹配不到则留空
 *   - 合同审批通过 → 自动创建 confirmed 合同
 *   - 付款审批通过 → 自动创建 confirmed 付款记录
 * ============================================================
 */

const wechatApiService = require('./wechatApiService');
const wechatConfig = require('../../config/wechat');
const {
  Contract,
  Payment,
  Customer,
  Supplier,
  BankAccount
} = require('../../models');
const logger = require('../../utils/logger');

// 模板 ID → 处理函数映射
const TEMPLATE_HANDLERS = {
  'C4NvsAEvbP3Hdue6QrZC5Aa9MSejNkjnyrJRskC1N': 'syncContract',
  '3WK7KALvNqVcVJN6Je4DUgKqZj4ZmsxjMwcSU6wU': 'syncPayment'
};

class WechatSyncService {
  /**
   * 处理回调事件（从 wechatController.receiveCallback 调用）
   * @param {string} xmlMessage 解密后的 XML 消息体
   */
  async handleCallback(xmlMessage) {
    // 解析 XML 中的审批相关字段
    const spNo = this._extractXmlField(xmlMessage, 'SpNo');
    const spStatus = this._extractXmlField(xmlMessage, 'SpStatus');

    if (!spNo) {
      logger.debug('[WechatSync] 非审批事件，跳过');
      return { handled: false };
    }

    // 仅处理审批通过（sp_status=2）
    if (spStatus !== '2') {
      logger.info(`[WechatSync] 审批单 ${spNo} 状态=${spStatus}，非通过状态，跳过`);
      return { handled: false, reason: 'not_approved' };
    }

    return await this.syncBySpNo(spNo);
  }

  /**
   * 按审批单号同步（回调触发 或 定时任务兜底调用）
   * @param {string} spNo 审批单号
   */
  async syncBySpNo(spNo) {
    try {
      // 拉取审批详情
      const detail = await wechatApiService.getApprovalDetail(spNo);
      const info = detail.info;

      if (!info) {
        logger.warn(`[WechatSync] ${spNo} 无详情数据`);
        return { handled: false, reason: 'no_detail' };
      }

      // 再次确认是已通过状态
      if (info.sp_status !== 2) {
        logger.info(`[WechatSync] ${spNo} 状态=${info.sp_status}，跳过`);
        return { handled: false, reason: 'not_approved' };
      }

      // 按模板分发
      const handler = TEMPLATE_HANDLERS[info.template_id];
      if (!handler) {
        logger.info(`[WechatSync] ${spNo} 模板 ${info.template_id} 未配置同步，跳过`);
        return { handled: false, reason: 'unknown_template' };
      }

      const result = await this[handler](info);
      logger.info(`[WechatSync] ${spNo} 同步完成`, result);
      return { handled: true, ...result };
    } catch (e) {
      logger.error(`[WechatSync] ${spNo} 同步失败`, { error: e.message });
      throw e;
    }
  }

  /**
   * 同步合同审批 → contracts 表
   */
  async syncContract(info) {
    const spNo = info.sp_no;
    const fields = this._parseApplyData(info.apply_data);

    // 幂等检查
    const existing = await Contract.findOne({ where: { sp_no: spNo } });
    if (existing) {
      logger.info(`[WechatSync] 合同 sp_no=${spNo} 已存在(id=${existing.id})，跳过`);
      return { action: 'skipped', reason: 'duplicate', id: existing.id };
    }

    // 解析字段
    const contractType = this._mapContractType(fields['合同类型']);
    const counterpartyName = fields['对方单位名称'] || '';
    const signDate = fields['签约日期'] || null;
    const amount = parseFloat(fields['合计金额']) || 0;
    const paidAmount = parseFloat(fields['已收款金额']) || 0;

    // 匹配客户/供应商（匹配不到则自动创建）
    let customer_id = null;
    let supplier_id = null;
    if (counterpartyName) {
      if (contractType === 'sale') {
        let customer = await Customer.findOne({ where: { name: counterpartyName } });
        if (!customer) {
          customer = await Customer.create({ name: counterpartyName });
          logger.info(`[WechatSync] 自动创建客户: ${counterpartyName}`);
        }
        customer_id = customer.id;
      } else {
        let supplier = await Supplier.findOne({ where: { name: counterpartyName } });
        if (!supplier) {
          supplier = await Supplier.create({ name: counterpartyName });
          logger.info(`[WechatSync] 自动创建供应商: ${counterpartyName}`);
        }
        supplier_id = supplier.id;
      }
    }

    // 查找申请人对应的 user_id
    const createdBy = await this._resolveUserId(info.applyer?.userid);

    // 创建合同
    const contract = await Contract.create({
      contract_no: `WX-${spNo}`,
      type: contractType,
      title: `${counterpartyName || '企微审批'} - ${fields['合同类型'] || '合同'}`,
      customer_id,
      supplier_id,
      amount,
      paid_amount: paidAmount,
      sign_date: signDate,
      status: 'active',
      sp_no: spNo,
      confirm_status: 'confirmed',
      remark: `企微审批自动同步 | 我方: ${fields['我方签订名称'] || '-'}`,
      created_by: createdBy
    });

    logger.info(`[WechatSync] 合同已创建: id=${contract.id}, sp_no=${spNo}`);
    return { action: 'created', type: 'contract', id: contract.id };
  }

  /**
   * 同步付款审批 → payments 表
   */
  async syncPayment(info) {
    const spNo = info.sp_no;
    const fields = this._parseApplyData(info.apply_data);

    // 幂等检查
    const existing = await Payment.findOne({ where: { sp_no: spNo } });
    if (existing) {
      logger.info(`[WechatSync] 付款 sp_no=${spNo} 已存在(id=${existing.id})，跳过`);
      return { action: 'skipped', reason: 'duplicate', id: existing.id };
    }

    // 解析字段
    const amount = parseFloat(fields['付款金额']) || 0;
    const paymentDate = fields['付款日期'] || new Date().toISOString().slice(0, 10);
    const summary = fields['付款事由'] || '';
    const paymentMethodName = fields['付款方式'] || '';

    // 匹配账户（优先按 remark 精确匹配简称，再按名称模糊匹配）
    let account_id = null;
    if (paymentMethodName) {
      // 1. 优先按 remark 精确匹配（remark 里存企微审批的简称）
      const byRemark = await BankAccount.findOne({
        where: { remark: paymentMethodName, status: 1 }
      });
      if (byRemark) {
        account_id = byRemark.id;
      } else {
        // 2. 按名称模糊匹配（取简称前几个字）
        const keyword = paymentMethodName.replace(/[-—].*$/, '').slice(0, 6);
        if (keyword.length >= 2) {
          const byName = await BankAccount.findOne({
            where: {
              name: { [require('sequelize').Op.like]: `%${keyword}%` },
              status: 1
            }
          });
          if (byName) account_id = byName.id;
        }
      }
    }
    // 3. 兜底：取第一个启用的账户
    if (!account_id) {
      const defaultAccount = await BankAccount.findOne({ where: { status: 1 } });
      if (defaultAccount) account_id = defaultAccount.id;
    }

    // 关联合同（通过 RelatedApproval 字段找到关联的合同审批 sp_no）
    let contract_id = null;
    const relatedSpNo = fields['关联合同_sp_no'];
    if (relatedSpNo) {
      const relatedContract = await Contract.findOne({ where: { sp_no: relatedSpNo } });
      if (relatedContract) contract_id = relatedContract.id;
    }

    // 判断类型：有关联合同则为业务类，否则为费用类
    const category = contract_id ? 'business' : 'fee';

    const createdBy = await this._resolveUserId(info.applyer?.userid);

    // 创建付款记录
    const payment = await Payment.create({
      type: 'expense',
      category,
      amount,
      payment_date: paymentDate,
      payment_method: 'transfer',
      account_id,
      contract_id,
      summary: summary.slice(0, 500),
      sp_no: spNo,
      confirm_status: 'confirmed',
      remark: `企微付款审批自动同步 | 方式: ${paymentMethodName}`,
      created_by: createdBy
    });

    logger.info(`[WechatSync] 付款已创建: id=${payment.id}, sp_no=${spNo}, amount=${amount}`);
    return { action: 'created', type: 'payment', id: payment.id };
  }

  /**
   * 批量同步（定时任务兜底用）
   * @param {number} hours 回溯小时数
   */
  async batchSync(hours = 2) {
    const now = Math.floor(Date.now() / 1000);
    const starttime = now - hours * 3600;

    let synced = 0;
    let skipped = 0;
    let failed = 0;

    try {
      const data = await wechatApiService.getApprovalInfo({ starttime, endtime: now, size: 100 });
      const spList = data.sp_no_list || [];

      logger.info(`[WechatSync] 批量同步: 发现 ${spList.length} 条审批单`);

      for (const spNo of spList) {
        try {
          const result = await this.syncBySpNo(spNo);
          if (result.handled) synced++;
          else skipped++;
        } catch (e) {
          failed++;
          logger.error(`[WechatSync] 批量同步 ${spNo} 失败`, { error: e.message });
        }
        // 控制频率，避免触发企微限流
        await this._sleep(200);
      }
    } catch (e) {
      logger.error('[WechatSync] 批量同步拉取列表失败', { error: e.message });
    }

    return { synced, skipped, failed };
  }

  // ==================== 私有工具方法 ====================

  /**
   * 解析 apply_data.contents 为 { 字段名: 值 } 的扁平对象
   */
  _parseApplyData(applyData) {
    const result = {};
    if (!applyData || !applyData.contents) return result;

    for (const item of applyData.contents) {
      const titleObj = item.title?.find(t => t.lang === 'zh_CN');
      const name = titleObj ? titleObj.text : item.id;
      const value = this._extractFieldValue(item);
      result[name] = value;

      // 特殊处理 RelatedApproval（关联审批）
      if (item.control === 'RelatedApproval' && item.value?.related_approval?.length > 0) {
        result[name + '_sp_no'] = item.value.related_approval[0].sp_no || '';
      }
    }

    return result;
  }

  /**
   * 从单个控件提取值
   */
  _extractFieldValue(item) {
    const v = item.value;
    if (!v) return '';

    switch (item.control) {
      case 'Text':
      case 'Textarea':
        return v.text || '';

      case 'Number':
        return v.new_number || '';

      case 'Money':
        return v.new_money || '';

      case 'Date':
        if (v.date && v.date.s_timestamp) {
          return new Date(parseInt(v.date.s_timestamp) * 1000).toISOString().slice(0, 10);
        }
        return '';

      case 'Selector':
        if (v.selector && v.selector.options && v.selector.options.length > 0) {
          return v.selector.options
            .map(o => {
              const txt = o.value?.find(x => x.lang === 'zh_CN');
              return txt ? txt.text : '';
            })
            .filter(Boolean)
            .join(',');
        }
        return '';

      case 'RelatedApproval':
        if (v.related_approval && v.related_approval.length > 0) {
          return v.related_approval.map(r => r.sp_no).join(',');
        }
        return '';

      default:
        return v.text || '';
    }
  }

  /**
   * 合同类型映射
   */
  _mapContractType(typeText) {
    if (!typeText) return 'sale';
    if (typeText.includes('采购') || typeText.includes('购买')) return 'purchase';
    if (typeText.includes('销售') || typeText.includes('转让')) return 'sale';
    return 'sale'; // 默认销售
  }

  /**
   * 企微 userid → ERP user_id
   * 通过 MainUser 表的 username 或 wx_openid 匹配
   */
  async _resolveUserId(wechatUserId) {
    if (!wechatUserId) return null;
    const { MainUser } = require('../../models');
    // 先按 username 匹配（很多企业 userid 就是拼音用户名）
    const user = await MainUser.findOne({
      where: { username: wechatUserId.toLowerCase() }
    });
    return user ? user.id : null;
  }

  /**
   * 从 XML 中提取字段值（简单正则）
   */
  _extractXmlField(xml, field) {
    if (!xml) return null;
    // 尝试 CDATA 格式
    const cdataMatch = xml.match(new RegExp(`<${field}><\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${field}>`));
    if (cdataMatch) return cdataMatch[1];
    // 尝试普通格式
    const plainMatch = xml.match(new RegExp(`<${field}>([^<]*)</${field}>`));
    if (plainMatch) return plainMatch[1];
    return null;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new WechatSyncService();
