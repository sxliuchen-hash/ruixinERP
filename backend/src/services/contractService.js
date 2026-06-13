const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const Contract = require('../models/Contract');
const Customer = require('../models/Customer');
const Supplier = require('../models/Supplier');
const Invoice = require('../models/Invoice');
const { NotFoundError, ValidationError, ForbiddenError } = require('../utils/errors');
const { parsePagination, buildPaginationResponse } = require('../utils/pagination');
const logger = require('../utils/logger');

class ContractService {
  /**
   * 获取合同列表（分页 + 筛选 + 数据隔离）
   * @param {object} query - 查询参数
   * @param {object} dataFilter - 数据隔离条件（来自 attachDataFilter 中间件）
   */
  async getList(query, dataFilter = {}) {
    const { page, limit, offset } = parsePagination(query);
    const { type, status, customer_id, supplier_id, keyword } = query;

    const where = { ...dataFilter };

    if (type) {
      where.type = type;
    }
    if (status) {
      where.status = status;
    }
    if (customer_id) {
      where.customer_id = parseInt(customer_id, 10);
    }
    if (supplier_id) {
      where.supplier_id = parseInt(supplier_id, 10);
    }
    if (keyword) {
      where[Op.or] = [
        { contract_no: { [Op.like]: `%${keyword}%` } },
        { title: { [Op.like]: `%${keyword}%` } }
      ];
    }

    // 排除已终止的合同（软删除），除非明确筛选 terminated
    if (!status) {
      where.status = { [Op.ne]: 'terminated' };
    }

    const data = await Contract.findAndCountAll({
      where,
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name'] },
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'] }
      ],
      order: [['sign_date', 'DESC'], ['id', 'DESC']],
      offset,
      limit
    });

    // 为每条合同计算执行进度
    const list = data.rows.map(contract => {
      const item = contract.toJSON();
      item.progress = this._calculateProgress(item.amount, item.paid_amount);
      return item;
    });

    return {
      list,
      pagination: {
        page,
        limit,
        total: data.count,
        totalPages: Math.ceil(data.count / limit)
      }
    };
  }

  /**
   * 获取合同详情（含关联收付款、发票）
   * @param {number} id - 合同ID
   * @param {object} dataFilter - 数据隔离条件
   */
  async getDetail(id, dataFilter = {}) {
    const where = { id, ...dataFilter };

    const contract = await Contract.findOne({
      where,
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name', 'contact_person', 'phone'] },
        { model: Supplier, as: 'supplier', attributes: ['id', 'name', 'contact_person', 'phone', 'tax_rate'] },
        { model: Invoice, as: 'invoices', attributes: ['id', 'type', 'invoice_type', 'invoice_no', 'amount', 'tax_amount', 'total_amount', 'invoice_date', 'status'] }
      ]
    });

    if (!contract) {
      throw new NotFoundError('合同不存在');
    }

    const result = contract.toJSON();

    // 计算执行进度
    result.progress = this._calculateProgress(result.amount, result.paid_amount);
    result.remaining_amount = parseFloat((parseFloat(result.amount || 0) - parseFloat(result.paid_amount || 0)).toFixed(2));

    // 查询关联收付款记录
    const payments = await sequelize.query(
      `SELECT id, type, amount, payment_date, payment_method, summary, confirm_status
       FROM payments WHERE contract_id = ? ORDER BY payment_date DESC`,
      { replacements: [id], type: QueryTypes.SELECT }
    );
    result.payments = payments;
    result.payment_count = payments.length;
    result.payment_total = payments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

    // 发票统计
    result.invoice_count = (result.invoices || []).length;
    result.invoice_total = (result.invoices || []).reduce(
      (sum, inv) => sum + parseFloat(inv.total_amount || inv.amount || 0), 0
    );

    return result;
  }

  /**
   * 创建合同
   * @param {object} data - 合同数据（已通过 Joi 校验）
   * @param {number} userId - 当前用户ID
   */
  async create(data, userId) {
    // 验证合同编号唯一性
    if (data.contract_no) {
      const existing = await Contract.findOne({ where: { contract_no: data.contract_no } });
      if (existing) {
        throw new ValidationError('合同编号已存在');
      }
    }

    // 销售合同必须关联客户，采购合同必须关联供应商
    if (data.type === 'sale' && !data.customer_id) {
      throw new ValidationError('销售合同必须关联客户');
    }
    if (data.type === 'purchase' && !data.supplier_id) {
      throw new ValidationError('采购合同必须关联供应商');
    }

    const contract = await Contract.create({
      ...data,
      amount: parseFloat(data.amount),
      paid_amount: 0,
      created_by: userId,
      owner_id: data.owner_id || userId
    });

    return contract;
  }

  /**
   * 更新合同
   * @param {number} id - 合同ID
   * @param {object} data - 更新数据（已通过 Joi 校验）
   * @param {object} dataFilter - 数据隔离条件
   */
  async update(id, data, dataFilter = {}) {
    const where = { id, ...dataFilter };
    const contract = await Contract.findOne({ where });

    if (!contract) {
      throw new NotFoundError('合同不存在');
    }

    // 已完成或已终止的合同不允许修改
    if (['completed', 'terminated'].includes(contract.status)) {
      throw new ValidationError('已完成或已终止的合同不允许修改');
    }

    // 如果修改了合同编号，检查唯一性
    if (data.contract_no && data.contract_no !== contract.contract_no) {
      const existing = await Contract.findOne({ where: { contract_no: data.contract_no } });
      if (existing) {
        throw new ValidationError('合同编号已存在');
      }
    }

    // 如果修改了金额，确保大于0
    if (data.amount !== undefined) {
      data.amount = parseFloat(data.amount);
    }

    await contract.update(data);
    return contract;
  }

  /**
   * 删除合同（软删除：设置状态为 terminated）
   * @param {number} id - 合同ID
   * @param {object} dataFilter - 数据隔离条件
   */
  async delete(id, dataFilter = {}) {
    const where = { id, ...dataFilter };
    const contract = await Contract.findOne({ where });

    if (!contract) {
      throw new NotFoundError('合同不存在');
    }

    // 已有收付款的合同不允许删除
    const [{ cnt }] = await sequelize.query(
      'SELECT COUNT(*) AS cnt FROM payments WHERE contract_id = ?',
      { replacements: [id], type: QueryTypes.SELECT }
    );
    if (parseInt(cnt, 10) > 0) {
      throw new ValidationError('该合同已有关联收付款记录，不允许删除');
    }

    await contract.update({ status: 'terminated' });
    return { id };
  }

  /**
   * 更新合同状态
   * @param {number} id - 合同ID
   * @param {string} status - 目标状态
   * @param {object} dataFilter - 数据隔离条件
   */
  async updateStatus(id, status, dataFilter = {}) {
    const where = { id, ...dataFilter };
    const contract = await Contract.findOne({ where });

    if (!contract) {
      throw new NotFoundError('合同不存在');
    }

    // 验证状态转换合法性
    const validTransitions = {
      draft: ['active', 'terminated'],
      active: ['completed', 'terminated'],
      completed: [],
      terminated: []
    };

    const allowedNextStatuses = validTransitions[contract.status] || [];
    if (!allowedNextStatuses.includes(status)) {
      throw new ValidationError(
        `不允许从 "${contract.status}" 转换到 "${status}"，允许的目标状态: ${allowedNextStatuses.join(', ') || '无'}`
      );
    }

    await contract.update({ status });
    return contract;
  }

  /**
   * 确认合同（企业微信同步来的待确认记录）
   * @param {number} id - 合同ID
   */
  async confirm(id) {
    const contract = await Contract.findByPk(id);
    if (!contract) {
      throw new NotFoundError('合同不存在');
    }

    if (contract.confirm_status === 'confirmed') {
      throw new ValidationError('该合同已确认');
    }

    await contract.update({ confirm_status: 'confirmed' });
    return contract;
  }

  /**
   * 上传合同附件（COS）
   * @param {number} id - 合同ID
   * @param {object} file - multer 文件对象
   * @param {object} dataFilter - 数据隔离条件
   */
  async uploadAttachment(id, file, dataFilter = {}) {
    const where = { id, ...dataFilter };
    const contract = await Contract.findOne({ where });

    if (!contract) {
      throw new NotFoundError('合同不存在');
    }

    let attachmentUrl;

    try {
      attachmentUrl = await this._uploadToCOS(file, contract.contract_no || `contract_${id}`);
    } catch (error) {
      logger.error('COS 上传失败:', { error: error.message, contractId: id });
      throw new ValidationError('文件上传失败，请稍后重试');
    }

    await contract.update({ attachment_url: attachmentUrl });
    return contract;
  }

  /**
   * 上传文件到腾讯云 COS
   * @param {object} file - multer 文件对象
   * @param {string} prefix - 文件名前缀
   * @returns {string} COS 文件 URL
   */
  async _uploadToCOS(file, prefix) {
    // 如果 COS 配置不完整，使用本地存储作为降级方案
    const { COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION } = process.env;

    if (!COS_SECRET_ID || !COS_SECRET_KEY || !COS_BUCKET || !COS_REGION) {
      // 降级：保存到本地 uploads 目录
      logger.warn('COS 配置不完整，使用本地存储降级');
      const fs = require('fs');
      const path = require('path');
      const uploadsDir = path.join(__dirname, '../../uploads/contracts');

      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const ext = path.extname(file.originalname);
      const filename = `${prefix}_${Date.now()}${ext}`;
      const filepath = path.join(uploadsDir, filename);

      fs.writeFileSync(filepath, file.buffer);
      return `/uploads/contracts/${filename}`;
    }

    // 正式 COS 上传
    const COS = require('cos-nodejs-sdk-v5');
    const path = require('path');

    const cos = new COS({
      SecretId: COS_SECRET_ID,
      SecretKey: COS_SECRET_KEY
    });

    const ext = path.extname(file.originalname);
    const key = `erp/contracts/${prefix}_${Date.now()}${ext}`;

    return new Promise((resolve, reject) => {
      cos.putObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype
      }, (err, data) => {
        if (err) {
          reject(err);
        } else {
          const url = `https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/${key}`;
          resolve(url);
        }
      });
    });
  }

  /**
   * 计算执行进度百分比
   * @param {number|string} amount - 合同总额
   * @param {number|string} paidAmount - 已收/已付金额
   * @returns {number} 进度百分比 (0-100)
   */
  _calculateProgress(amount, paidAmount) {
    const total = parseFloat(amount) || 0;
    const paid = parseFloat(paidAmount) || 0;
    if (total <= 0) return 0;
    const progress = (paid / total) * 100;
    return parseFloat(Math.min(progress, 100).toFixed(2));
  }
}

module.exports = new ContractService();
