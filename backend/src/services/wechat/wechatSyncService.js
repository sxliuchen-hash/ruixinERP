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
const { Op } = require('sequelize');
const {
  Contract,
  Payment,
  Expense,
  Customer,
  Supplier,
  BankAccount,
  Employee,
  CostCategory
} = require('../../models');
const { sequelize } = require('../../config/database');
const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class WechatSyncService {
  constructor() {
    this._reportedTemplateSignature = '';
    this._reportTemplateConfiguration();
  }

  _getTemplateConfiguration() {
    return wechatConfig.resolveTemplateConfiguration(wechatConfig.templates);
  }

  _reportTemplateConfiguration() {
    const signature = JSON.stringify(wechatConfig.templates || {});
    if (signature === this._reportedTemplateSignature) return;
    this._reportedTemplateSignature = signature;
    const resolution = this._getTemplateConfiguration();
    if (resolution.duplicates.length > 0) {
      logger.error('[WechatSync] 审批模板 ID 重复配置，冲突模板已 fail-closed', {
        conflicts: resolution.duplicates.map((item) => item.types.join('/'))
      });
    }
    if (resolution.unsupported.length > 0) {
      logger.warn('[WechatSync] 存在尚未支持的审批模板类型，已忽略', {
        types: resolution.unsupported.map((item) => item.type)
      });
    }
    return resolution;
  }
  /**
   * 处理回调事件（从 wechatController.receiveCallback 调用）
   * @param {string} xmlMessage 解密后的 XML 消息体
   */
  async handleCallback(xmlMessage) {
    // 检查是否为成员变更事件
    const changeType = this._extractXmlField(xmlMessage, 'ChangeType');
    if (changeType === 'create_user') {
      return await this._handleNewMember(xmlMessage);
    }

    // 解析 XML 中的审批相关字段
    const spNo = this._extractXmlField(xmlMessage, 'SpNo');
    const spStatus = this._extractXmlField(xmlMessage, 'SpStatus');

    if (!spNo) {
      logger.debug('[WechatSync] 非审批事件，跳过');
      return { handled: false };
    }

    // 处理审批中(1)、通过(2)、驳回(3)、撤销(4)
    if (!['1', '2', '3', '4'].includes(spStatus)) {
      logger.debug(`[WechatSync] 审批单 ${spNo} 状态=${spStatus}，跳过`);
      return { handled: false, reason: 'unknown_status' };
    }

    return await this.syncBySpNo(spNo);
  }

  /**
   * 按审批单号同步（回调触发 或 定时任务兜底调用）
   * @param {string} spNo 审批单号
   */
  async syncBySpNo(spNo) {
    const normalizedSpNo = String(spNo || '').trim();
    if (!normalizedSpNo || normalizedSpNo.length > 50) {
      throw new AppError('企微审批单号格式无效', 400, 'WECHAT_SP_NO_INVALID');
    }
    try {
      // 拉取审批详情
      const detail = await wechatApiService.getApprovalDetail(normalizedSpNo);
      const info = detail.info;

      if (!info) {
        logger.warn(`[WechatSync] ${normalizedSpNo} 无详情数据`);
        return { handled: false, reason: 'no_detail' };
      }
      if (String(info.sp_no || '').trim() !== normalizedSpNo) {
        throw new AppError(
          '企微审批详情单号与请求不一致',
          503,
          'WECHAT_SP_NO_MISMATCH'
        );
      }

      // 处理驳回/撤销：如果 ERP 已有记录，更新为 terminated
      if (info.sp_status === 3 || info.sp_status === 4) {
        return await this._handleRejected(normalizedSpNo, info.sp_status);
      }

      // 审批中(1)或已通过(2)都同步
      if (info.sp_status !== 1 && info.sp_status !== 2) {
        logger.info(`[WechatSync] ${normalizedSpNo} 状态=${info.sp_status}，跳过`);
        return { handled: false, reason: 'unknown_status' };
      }

      // 按配置的模板 ID 分发；重复 ID 和未支持类型均 fail-closed。
      const templateConfiguration = this._reportTemplateConfiguration() || this._getTemplateConfiguration();
      const handler = templateConfiguration.handlers[info.template_id];
      if (!handler) {
        const duplicate = templateConfiguration.duplicates
          .some((item) => item.templateId === info.template_id);
        const unsupported = templateConfiguration.unsupported
          .some((item) => item.templateId === info.template_id);
        logger.info(`[WechatSync] ${normalizedSpNo} 模板 ${info.template_id} 未配置同步，跳过`);
        return {
          handled: false,
          reason: duplicate
            ? 'template_configuration_conflict'
            : (unsupported ? 'unsupported_template' : 'unknown_template')
        };
      }

      let result;
      try {
        result = await this[handler](info);
      } catch (error) {
        if (error?.name !== 'SequelizeUniqueConstraintError') throw error;
        const modelByHandler = {
          syncContract: Contract,
          syncPayment: Payment,
          syncExpense: Expense
        };
        const model = modelByHandler[handler];
        const existing = model
          ? await model.findOne({ where: { sp_no: info.sp_no } })
          : null;
        if (!existing) throw error;
        result = {
          action: 'skipped',
          reason: 'duplicate',
          type: handler.replace(/^sync/, '').toLowerCase(),
          id: existing.id
        };
      }
      logger.info(`[WechatSync] ${normalizedSpNo} 同步完成`, result);
      return { handled: true, ...result };
    } catch (e) {
      logger.error(`[WechatSync] ${normalizedSpNo} 同步失败`, { error: e.message });
      throw e;
    }
  }

  /**
   * 同步合同审批 → contracts 表
   */
  async syncContract(info) {
    const spNo = info.sp_no;
    const fields = this._parseApplyData(info.apply_data);
    const createdBy = await this._resolveApprovalOwnerId(info, 'contract');

    // 幂等检查：已存在则更新状态
    const existing = await Contract.findOne({ where: { sp_no: spNo } });
    if (existing) {
      // 更新状态（审批通过+流程结束=completed，审批中=active）
      const flowEnd = fields['流程结束'] || '';
      let newStatus = 'active';
      if (info.sp_status === 2 && flowEnd.includes('是')) newStatus = 'completed';
      else if (info.sp_status === 2) newStatus = 'active';
      const newConfirmStatus = info.sp_status === 2 ? 'confirmed' : 'pending';

      if (
        existing.status !== 'terminated' &&
        (existing.status !== newStatus || existing.confirm_status !== newConfirmStatus)
      ) {
        await existing.update({ status: newStatus, confirm_status: newConfirmStatus });
        logger.info(`[WechatSync] 合同 ${spNo} 状态更新: ${existing.status} → ${newStatus}`);
        return {
          action: 'updated',
          type: 'contract',
          id: existing.id,
          status: newStatus,
          confirmStatus: newConfirmStatus
        };
      }
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

    // 生成合同编号：CZ-类型+年月日+5位流水号
    const contractNo = await this._generateContractNo(contractType, signDate);

    // 判断合同状态
    const flowEnd = fields['流程结束'] || '';
    let contractStatus = 'active'; // 默认进行中
    if (info.sp_status === 2 && flowEnd.includes('是')) {
      contractStatus = 'completed';
    }

    // 创建合同
    const contract = await Contract.create({
      contract_no: contractNo,
      type: contractType,
      title: `${counterpartyName || '企微审批'} - ${fields['合同类型'] || '合同'}`,
      customer_id,
      supplier_id,
      amount,
      paid_amount: paidAmount,
      sign_date: signDate,
      status: contractStatus,
      sp_no: spNo,
      confirm_status: info.sp_status === 2 ? 'confirmed' : 'pending',
      applyer_name: await this._getApplyerName(info),
      our_company: fields['我方签订名称'] || '',
      remark: `企微审批自动同步 | 我方: ${fields['我方签订名称'] || '-'}`,
      created_by: createdBy
    });

    let autoPayment = null;
    // 只有审批通过且收款账户唯一明确时，才创建 confirmed 收款资金记录。
    if (paidAmount > 0 && contractType === 'sale') {
      const receiptAccountName = this._pickField(fields, [
        '收款账户', '到账账户', '入账账户', '收款方式'
      ]);
      const receiptAccountId = info.sp_status === 2
        ? await this._resolveBankAccountId(receiptAccountName)
        : null;
      if (!receiptAccountId) {
        autoPayment = {
          created: false,
          reason: info.sp_status === 2
            ? 'account_unresolved'
            : 'approval_pending'
        };
      } else {
        const paymentNo = await this._generatePaymentNo('income', signDate);
        const receipt = await Payment.create({
          payment_no: paymentNo,
          type: 'income',
          category: 'business',
          amount: paidAmount,
          payment_date: signDate || new Date().toISOString().slice(0, 10),
          payment_method: 'transfer',
          account_id: receiptAccountId,
          contract_id: contract.id,
          customer_id,
          sp_no: `${spNo}-SK`,
          confirm_status: 'confirmed',
          summary: `合同 ${contractNo} 已收款（审批同步）`,
          created_by: createdBy
        });
        autoPayment = { created: true, id: receipt.id };
        logger.info(`[WechatSync] 自动创建收款: 合同${contract.id}, 金额${paidAmount}`);
      }
    }

    logger.info(`[WechatSync] 合同已创建: id=${contract.id}, sp_no=${spNo}, status=${contractStatus}`);
    return {
      action: 'created',
      type: 'contract',
      id: contract.id,
      ...(autoPayment && { autoPayment })
    };
  }

  /**
   * 同步付款审批 → payments 表
   */
  async syncPayment(info) {
    const spNo = String(info.sp_no || '').trim();
    const fields = this._parseApplyData(info.apply_data);
    const amount = this._parseMoney(fields['付款金额']);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError('企微付款金额无效', 422, 'WECHAT_PAYMENT_AMOUNT_INVALID');
    }
    const createdBy = await this._resolveApprovalOwnerId(info, 'payment');
    const paymentDate = fields['付款日期'] || new Date().toISOString().slice(0, 10);
    const summary = fields['付款事由'] || '';
    const paymentMethodName = fields['付款方式'] || '';

    // 关联合同（通过 RelatedApproval 字段找到关联的合同审批 sp_no）
    let contractId = null;
    const relatedSpNo = fields['关联合同_sp_no'];
    if (relatedSpNo) {
      const relatedContract = await Contract.findOne({ where: { sp_no: relatedSpNo } });
      if (relatedContract) contractId = relatedContract.id;
    }
    const category = contractId ? 'business' : 'fee';
    const accountId = info.sp_status === 2
      ? await this._resolveBankAccountId(paymentMethodName)
      : null;
    const confirmStatus = info.sp_status === 2 && accountId
      ? 'confirmed'
      : 'pending';
    const applyerName = await this._getApplyerName(info);
    const payload = {
      type: 'expense',
      category,
      amount,
      payment_date: paymentDate,
      payment_method: 'transfer',
      account_id: confirmStatus === 'confirmed' ? accountId : null,
      contract_id: contractId,
      summary: summary.slice(0, 500),
      sp_no: spNo,
      confirm_status: confirmStatus,
      applyer_name: applyerName,
      remark: [
        '企微付款审批自动同步',
        paymentMethodName ? `方式: ${paymentMethodName}` : '',
        info.sp_status === 2 && !accountId ? '待修复唯一账户映射' : ''
      ].filter(Boolean).join(' | '),
      created_by: createdBy
    };

    const existing = await Payment.findOne({ where: { sp_no: spNo } });
    if (existing) {
      if (existing.confirm_status === 'confirmed') {
        return { action: 'skipped', reason: 'duplicate', type: 'payment', id: existing.id };
      }

      if (confirmStatus !== 'confirmed') {
        await existing.update(payload);
        return {
          action: 'updated',
          type: 'payment',
          id: existing.id,
          status: 'pending',
          ...(info.sp_status === 2 && { reason: 'account_confirmation_required' })
        };
      }

      let transitioned = false;
      await sequelize.transaction(async (transaction) => {
        const [updatedCount] = await Payment.update(payload, {
          where: { id: existing.id, confirm_status: 'pending' },
          transaction
        });
        if (updatedCount !== 1) return;
        const confirmedPayment = await Payment.findByPk(existing.id, { transaction });
        if (!confirmedPayment) {
          throw new AppError('企微付款状态更新后记录不存在', 503, 'WECHAT_PAYMENT_STATE_ERROR');
        }
        await require('../paymentService').applyConfirmedSideEffects(
          confirmedPayment,
          transaction
        );
        transitioned = true;
      });
      return transitioned
        ? { action: 'updated', type: 'payment', id: existing.id, status: 'confirmed' }
        : { action: 'skipped', reason: 'duplicate', type: 'payment', id: existing.id };
    }

    const paymentNo = await this._generatePaymentNo('expense', paymentDate);
    let payment;
    if (confirmStatus === 'confirmed') {
      await sequelize.transaction(async (transaction) => {
        payment = await Payment.create({ payment_no: paymentNo, ...payload }, { transaction });
        await require('../paymentService').applyConfirmedSideEffects(payment, transaction);
      });
    } else {
      payment = await Payment.create({ payment_no: paymentNo, ...payload });
    }

    return {
      action: 'created',
      type: 'payment',
      id: payment.id,
      status: confirmStatus,
      ...(info.sp_status === 2 && !accountId && {
        reason: 'account_confirmation_required'
      })
    };
  }

  /**
   * 同步报销审批 → expenses 表。
   * 审批中写入 pending；审批通过且能明确解析付款账户时写入 confirmed。
   * 账户无法安全匹配时保留 pending，避免错误账户被直接扣减。
   */
  async syncExpense(info) {
    const spNo = String(info.sp_no || '').trim();
    const fields = this._parseApplyData(info.apply_data);
    const aliases = wechatConfig.expenseFieldAliases;
    const amount = this._parseMoney(this._pickField(fields, aliases.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError('企微报销金额无效', 422, 'WECHAT_EXPENSE_AMOUNT_INVALID');
    }

    const userId = await this._resolveApprovalOwnerId(info, 'expense');

    const expenseDate = this._resolveApprovalDate(
      this._pickField(fields, aliases.expenseDate),
      info.apply_time
    );
    const summaryValue = this._pickField(fields, aliases.summary);
    const summary = String(summaryValue || `企微报销 ${spNo}`).slice(0, 500);
    const categoryName = this._pickField(fields, aliases.category);
    const accountName = this._pickField(fields, aliases.account);
    const [costCategoryId, accountId, applyerName] = await Promise.all([
      this._resolveCostCategoryId(categoryName),
      this._resolveBankAccountId(accountName),
      this._getApplyerName(info)
    ]);
    const confirmStatus = info.sp_status === 2 && accountId
      ? 'confirmed'
      : 'pending';
    const payload = {
      user_id: userId,
      amount,
      cost_category_id: costCategoryId,
      expense_date: expenseDate,
      account_id: accountId,
      sp_no: spNo,
      confirm_status: confirmStatus,
      summary,
      remark: [
        '企业微信报销审批自动同步',
        applyerName ? `申请人: ${applyerName}` : '',
        categoryName ? `类别: ${categoryName}` : '',
        accountName ? `账户: ${accountName}` : '',
        info.sp_status === 2 && !accountId ? '待人工确认付款账户' : ''
      ].filter(Boolean).join(' | '),
      created_by: userId
    };

    const existing = await Expense.findOne({ where: { sp_no: spNo } });
    if (existing) {
      if (existing.confirm_status === 'confirmed') {
        return { action: 'skipped', reason: 'duplicate', type: 'expense', id: existing.id };
      }
      await existing.update(payload);
      return {
        action: 'updated',
        type: 'expense',
        id: existing.id,
        status: confirmStatus,
        ...(confirmStatus === 'pending' && info.sp_status === 2 && {
          reason: 'account_confirmation_required'
        })
      };
    }

    const expense = await Expense.create(payload);
    return {
      action: 'created',
      type: 'expense',
      id: expense.id,
      status: confirmStatus,
      ...(confirmStatus === 'pending' && info.sp_status === 2 && {
        reason: 'account_confirmation_required'
      })
    };
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

  /**
   * 获取审批申请人姓名
   */
  async _getApplyerName(info) {
    if (!info.applyer || !info.applyer.userid) return '';
    try {
      const userInfo = await wechatApiService.getUser(info.applyer.userid);
      return userInfo.name || info.applyer.userid;
    } catch (e) {
      return info.applyer.userid;
    }
  }

  /**
   * 处理驳回/撤销的审批 → 更新 ERP 记录为 terminated
   */
  async _handleRejected(spNo, spStatus) {
    const statusLabel = spStatus === 3 ? '驳回' : '撤销';

    // 检查合同
    const contract = await Contract.findOne({ where: { sp_no: spNo } });
    if (contract && contract.status !== 'terminated') {
      await contract.update({ status: 'terminated' });
      logger.info(`[WechatSync] 合同 ${spNo} 已${statusLabel}，状态→terminated`);
      return { handled: true, action: 'terminated', type: 'contract', id: contract.id };
    }

    // 检查付款
    const payment = await Payment.findOne({ where: { sp_no: spNo } });
    if (payment) {
      await require('../paymentService').delete(payment.id, {});
      logger.info(`[WechatSync] 付款 ${spNo} 已${statusLabel}，已删除`);
      return { handled: true, action: 'deleted', type: 'payment', id: payment.id };
    }

    // 报销余额由账户服务实时聚合；删除 confirmed 报销即同步撤销其账户影响。
    const expense = await Expense.findOne({ where: { sp_no: spNo } });
    if (expense) {
      await expense.destroy();
      logger.info(`[WechatSync] 报销 ${spNo} 已${statusLabel}，已删除`);
      return { handled: true, action: 'deleted', type: 'expense', id: expense.id };
    }

    return { handled: false, reason: 'no_record_to_reject' };
  }

  // ==================== 私有工具方法 ====================

  /**
   * 处理企微新成员加入事件 → 自动创建员工档案
   */
  async _handleNewMember(xmlMessage) {
    const userid = this._extractXmlField(xmlMessage, 'UserID');
    const name = this._extractXmlField(xmlMessage, 'Name');
    const department = this._extractXmlField(xmlMessage, 'Department');

    if (!userid) {
      return { handled: false, reason: 'no_userid' };
    }

    // 检查是否已存在
    const existing = await Employee.findOne({ where: { wechat_userid: userid } });
    if (existing) {
      logger.info(`[WechatSync] 员工 ${userid} 已存在，跳过`);
      return { handled: false, reason: 'duplicate' };
    }

    // 创建员工档案
    const employee = await Employee.create({
      name: name || userid,
      wechat_userid: userid,
      role: 'sales', // 默认为销售，admin 后续手动调整
      status: 'probation',
      hire_date: new Date().toISOString().slice(0, 10),
      region: '西安',
      base_salary: 2400,
      position_allowance: 1000,
      attendance_bonus: 100,
      remark: `企微自动创建 | 部门: ${department || '-'}`
    });

    logger.info(`[WechatSync] 新员工档案已创建: ${name}(${userid}), id=${employee.id}`);
    return { handled: true, action: 'employee_created', id: employee.id, name };
  }

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
          // 企微时间戳是北京时间的 0 点，用本地时间转换避免时区偏移
          const d = new Date(parseInt(v.date.s_timestamp) * 1000);
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
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

  _pickField(fields, aliases = []) {
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(fields, alias)) {
        const value = fields[alias];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          return value;
        }
      }
    }
    return '';
  }

  _parseMoney(value) {
    const normalized = String(value || '')
      .replace(/,/g, '')
      .replace(/[^0-9.-]/g, '');
    return Number.parseFloat(normalized);
  }

  _resolveApprovalDate(value, applyTime) {
    const candidate = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
    const timestamp = Number(applyTime);
    const date = Number.isFinite(timestamp) && timestamp > 0
      ? new Date(timestamp * 1000)
      : new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async _resolveCostCategoryId(categoryName) {
    const normalized = String(categoryName || '').trim();
    if (!normalized) return null;
    const category = await CostCategory.findOne({
      where: { name: normalized, status: 1 },
      attributes: ['id']
    });
    return category?.id || null;
  }

  async _resolveBankAccountId(accountName) {
    const normalized = String(accountName || '').trim();
    if (!normalized) return null;

    const byRemark = await BankAccount.findAll({
      where: { remark: normalized, status: 1 },
      attributes: ['id'],
      limit: 2
    });
    if (byRemark.length === 1) return byRemark[0].id;
    if (byRemark.length > 1) return null;

    const keyword = normalized.replace(/[-—].*$/, '').slice(0, 12).trim();
    if (keyword.length < 2) return null;
    const byName = await BankAccount.findAll({
      where: {
        name: { [Op.like]: `%${keyword}%` },
        status: 1
      },
      attributes: ['id'],
      limit: 2
    });
    return byName.length === 1 ? byName[0].id : null;
  }

  /**
   * 生成付款/收款编号：CZ-{FK/SK}{年月日}{5位流水号}
   */
  async _generatePaymentNo(type, paymentDate) {
    const { Op } = require('sequelize');
    const typeCode = type === 'income' ? 'SK' : 'FK';
    const dateStr = (paymentDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    const prefix = `CZ-${typeCode}${dateStr}`;

    const last = await Payment.findOne({
      where: { payment_no: { [Op.like]: `${prefix}%` } },
      order: [['payment_no', 'DESC']]
    });

    let seq = 1;
    if (last && last.payment_no) {
      const lastSeq = parseInt(last.payment_no.slice(prefix.length)) || 0;
      seq = lastSeq + 1;
    }

    return `${prefix}${String(seq).padStart(5, '0')}`;
  }

  /**
   * 生成合同编号：CZ-{类型}{年月日}{5位流水号}
   * 示例：CZ-XS2026051300001 / CZ-CG2026051300001
   */
  async _generateContractNo(type, signDate) {
    const { Op } = require('sequelize');
    const typeCode = type === 'sale' ? 'XS' : 'CG';
    const dateStr = (signDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    const prefix = `CZ-${typeCode}${dateStr}`;

    // 查当天最大流水号
    const last = await Contract.findOne({
      where: { contract_no: { [Op.like]: `${prefix}%` } },
      order: [['contract_no', 'DESC']]
    });

    let seq = 1;
    if (last && last.contract_no) {
      const lastSeq = parseInt(last.contract_no.slice(prefix.length)) || 0;
      seq = lastSeq + 1;
    }

    return `${prefix}${String(seq).padStart(5, '0')}`;
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
   * 只通过 ERP 员工档案的明确绑定匹配，不再查询主项目数据库或猜测 username。
   */
  async _resolveUserId(wechatUserId) {
    if (!wechatUserId) return null;
    const normalizedWechatUserId = String(wechatUserId).trim();
    if (!normalizedWechatUserId) return null;

    const employee = await Employee.findOne({
      where: { wechat_userid: normalizedWechatUserId },
      attributes: ['user_id']
    });
    const userId = Number(employee?.user_id);
    if (Number.isInteger(userId) && userId > 0) return userId;

    logger.warn('[WechatSync] 企微成员尚未绑定主项目用户，业务记录不写入属主', {
      wechatUserId: normalizedWechatUserId
    });
    return null;
  }

  /**
   * 统一执行企微审批申请人的主账号绑定策略。
   * 非法或缺失配置均按 reject 处理；只有显式 allow_unowned 才允许返回 null。
   */
  async _resolveApprovalOwnerId(info, approvalType) {
    const wechatUserId = String(info?.applyer?.userid || '').trim();
    const userId = await this._resolveUserId(wechatUserId);
    if (userId) return userId;

    const policy = wechatConfig.resolveUnboundApprovalPolicy();
    if (policy.valid && policy.policy === 'allow_unowned') {
      logger.warn('[WechatSync] 企微审批申请人未绑定主账号，按兼容策略写入无属主记录', {
        approvalType,
        wechatUserId
      });
      return null;
    }

    throw new AppError(
      '企微审批申请人尚未绑定 ERP 主账号',
      409,
      'WECHAT_APPROVAL_APPLYER_UNBOUND'
    );
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
module.exports.WechatSyncService = WechatSyncService;
