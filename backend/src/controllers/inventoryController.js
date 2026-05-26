/**
 * ============================================================
 * 专利库存 Controller
 * ============================================================
 * 薄层转接，调用 inventoryService 执行业务。
 * 参数校验由 validate + Joi 处理，数据隔离由 attachDataFilter 处理。
 * ============================================================
 */

const inventoryService = require('../services/inventoryService');
const inventoryBatchService = require('../services/inventoryBatchService');
const patentAnomalyService = require('../services/patentAnomalyService');
const { sendExcel } = require('../utils/excelHelper');

/** GET /api/v1/inventory */
async function getList(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const result = await inventoryService.getList(req.query, userId, userRole);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/inventory/overview - 库存总览统计 */
async function getOverview(req, res, next) {
  try {
    const data = await inventoryService.getOverview();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/inventory/expiring - 即将到期列表 */
async function getExpiring(req, res, next) {
  try {
    const data = await inventoryService.getExpiring(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/inventory/:id - 详情（含年费、调价历史） */
async function getDetail(req, res, next) {
  try {
    const { id } = req.params;
    const data = await inventoryService.getDetail(parseInt(id, 10));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/inventory - 入库 */
async function create(req, res, next) {
  try {
    const data = await inventoryService.create(req.body, req.user.id);
    res.status(201).json({ success: true, message: '库存记录创建成功', data });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/inventory/:id */
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.update(parseInt(id, 10), req.body, userId, userRole);
    res.json({ success: true, message: '库存记录更新成功', data });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/v1/inventory/:id */
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.delete(parseInt(id, 10), userId, userRole);
    res.json({ success: true, message: '库存记录已删除', data });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/inventory/batch-delete - 批量删除（仅管理员） */
async function batchDelete(req, res, next) {
  try {
    const { ids } = req.body;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.batchDelete(ids, userId, userRole);
    res.json({
      success: true,
      message: `已删除 ${data.deleted} 条记录`,
      data
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/inventory/:id/status - 变更状态（售出/放弃/转让中） */
async function changeStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status, stock_out_date } = req.body;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.changeStatus(
      parseInt(id, 10),
      status,
      stock_out_date,
      userId,
      userRole
    );
    res.json({ success: true, message: '状态变更成功', data });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/inventory/:id/price - 单个调价 */
async function changePrice(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.changePrice(parseInt(id, 10), req.body, userId, userRole);
    res.json({ success: true, message: '调价成功', data });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/inventory/batch-price - 批量调价 */
async function batchChangePrice(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.batchChangePrice(req.body, userId, userRole);
    res.json({
      success: true,
      message: `批量调价完成，影响 ${data.affected} 条`,
      data
    });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/inventory/:id/fees - 添加年费记录 */
async function addAnnualFee(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.addAnnualFee(
      parseInt(id, 10),
      req.body,
      userId,
      userRole
    );
    res.status(201).json({ success: true, message: '年费记录添加成功', data });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/v1/inventory/:id/fees/:feeId - 删除年费记录 */
async function deleteAnnualFee(req, res, next) {
  try {
    const { id, feeId } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.deleteAnnualFee(
      parseInt(id, 10),
      parseInt(feeId, 10),
      userId,
      userRole
    );
    res.json({ success: true, message: '年费记录已删除', data });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/inventory/:id/sync-from-ip - 从 IP 系统同步专利信息 */
async function syncFromIpSystem(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;

    // 先获取库存记录拿到 patent_no
    const inv = await inventoryService.getDetail(parseInt(id, 10));

    // 调用 IP 系统获取最新数据
    const ipSystemService = require('../services/ipSystemService');
    const ipData = await ipSystemService.getPatentFeeDetail(inv.patent_no, req);

    // 同步到本地
    const result = await inventoryService.syncFromIpSystem(
      parseInt(id, 10),
      ipData,
      userId,
      userRole
    );

    res.json({
      success: true,
      message: result.updated > 0
        ? `同步成功，更新了 ${result.updated} 个字段`
        : '数据已是最新',
      data: { ...result, ipData }
    });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/inventory/batch-import/template - 下载批量入库模板 */
async function batchImportTemplate(req, res, next) {
  try {
    const { buffer, filename } = await inventoryBatchService.generateTemplate();
    sendExcel(res, buffer, filename);
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/inventory/batch-import/validate - 上传 Excel 预览校验 */
async function batchImportValidate(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传 Excel 文件' });
    }
    const result = await inventoryBatchService.parseAndValidate(req.file.buffer);
    res.json({
      success: true,
      message: '校验完成',
      data: {
        total: result.total,
        validCount: result.valid.length,
        errorCount: result.errors.length,
        valid: result.valid,
        errors: result.errors
      }
    });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/inventory/batch-import/execute - 确认批量入库 */
async function batchImportExecute(req, res, next) {
  try {
    const { validRows } = req.body;
    const userId = req.user.id;
    const result = await inventoryBatchService.batchImport(validRows, userId, req);
    res.json({
      success: true,
      message: `批量入库完成：成功 ${result.imported} 条，跳过 ${result.skipped} 条，失败 ${result.failed} 条`,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/inventory/anomalies - 获取异常告警列表 */
async function getAnomalies(req, res, next) {
  try {
    const data = await patentAnomalyService.getList(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/inventory/anomalies/overview - 异常告警统计 */
async function getAnomalyOverview(req, res, next) {
  try {
    const data = await patentAnomalyService.getOverview();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/v1/inventory/anomalies/:id/resolve - 标记告警已处理 */
async function resolveAnomaly(req, res, next) {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const userId = req.user.id;
    const data = await patentAnomalyService.markResolved(parseInt(id, 10), userId, note);
    if (!data) {
      return res.status(404).json({ success: false, message: '告警记录不存在' });
    }
    res.json({ success: true, message: '已标记为处理', data });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/inventory/anomalies/scan - 手动触发批量扫描（仅管理员） */
async function triggerAnomalyScan(req, res, next) {
  try {
    const job = require('../jobs/patentBatchQueryJob');

    // 检查是否已在运行
    const current = await job.getProgress();
    if (current && current.status === 'running') {
      return res.json({
        success: false,
        message: '扫描任务正在运行中，请等待完成',
        data: current
      });
    }

    // 异步执行
    job.run().catch(e => {
      require('../utils/logger').error('手动触发扫描失败:', e);
    });

    res.json({
      success: true,
      message: '扫描任务已启动'
    });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/inventory/anomalies/scan-progress - 获取扫描进度 */
async function getScanProgress(req, res, next) {
  try {
    const job = require('../jobs/patentBatchQueryJob');
    const progress = await job.getProgress();
    res.json({
      success: true,
      data: progress || { status: 'idle', total: 0, scanned: 0, failed: 0, alerts: 0, logs: [] }
    });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/inventory/:id/sell - 标记已售 */
async function markAsSold(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.markAsSold(parseInt(id, 10), req.body, userId, userRole);
    res.json({ success: true, message: '已标记为已售', data });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/inventory/:id/unsell - 撤销已售 */
async function unsell(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.unsell(parseInt(id, 10), userId, userRole);
    res.json({ success: true, message: '已撤销，恢复为在库', data });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/inventory/sold - 已售归档列表 */
async function getSoldList(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const result = await inventoryService.getSoldList(req.query, userId, userRole);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/inventory/sold/stats - 已售统计摘要 */
async function getSoldStats(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.getSoldStats(userId, userRole);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** GET /api/v1/inventory/sold/analytics - 已售统计分析（图表） */
async function getSoldAnalytics(req, res, next) {
  try {
    const { id: userId, role: userRole } = req.user;
    const data = await inventoryService.getSoldAnalytics(req.query, userId, userRole);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/inventory/anomalies/scan-stop - 停止扫描 */
async function stopScan(req, res, next) {
  try {
    const job = require('../jobs/patentBatchQueryJob');
    await job.requestStop();
    res.json({ success: true, message: '已发送停止信号，任务将在当前专利处理完后停止' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getList,
  getOverview,
  getExpiring,
  getDetail,
  create,
  update,
  remove,
  batchDelete,
  changeStatus,
  changePrice,
  batchChangePrice,
  addAnnualFee,
  deleteAnnualFee,
  syncFromIpSystem,
  batchImportTemplate,
  batchImportValidate,
  batchImportExecute,
  getAnomalies,
  getAnomalyOverview,
  resolveAnomaly,
  triggerAnomalyScan,
  getScanProgress,
  stopScan,
  markAsSold,
  unsell,
  getSoldList,
  getSoldStats,
  getSoldAnalytics
};
