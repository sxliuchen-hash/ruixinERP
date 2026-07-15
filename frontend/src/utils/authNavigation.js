import { PERMISSIONS } from '../constants/permissions.js'

const AUTHORIZED_DESTINATIONS = Object.freeze([
  { path: '/dashboard', permission: PERMISSIONS.DASHBOARD_VIEW, pattern: /^\/dashboard(?:[/?#]|$)/ },
  { path: '/contracts', permission: PERMISSIONS.CONTRACT_VIEW, pattern: /^\/contracts(?:[/?#]|$)/ },
  { path: '/payments', permission: PERMISSIONS.PAYMENT_VIEW, pattern: /^\/payments(?:[/?#]|$)/ },
  { path: '/invoices', permission: PERMISSIONS.INVOICE_VIEW, pattern: /^\/invoices(?:[/?#]|$)/ },
  { path: '/expenses', permission: PERMISSIONS.EXPENSE_VIEW, pattern: /^\/expenses(?:[/?#]|$)/ },
  { path: '/loans', permission: PERMISSIONS.LOAN_VIEW, pattern: /^\/loans(?:[/?#]|$)/ },
  { path: '/projects', permission: PERMISSIONS.PROJECT_VIEW, pattern: /^\/projects(?:[/?#]|$)/ },
  { path: '/inventory/anomalies', permission: PERMISSIONS.INVENTORY_ANOMALY_VIEW, pattern: /^\/inventory\/anomalies(?:[/?#]|$)/ },
  {
    path: '/inventory/sold-analytics',
    permission: PERMISSIONS.INVENTORY_VIEW,
    pattern: /^\/inventory\/sold-analytics(?:[/?#]|$)/,
    fallback: false
  },
  { path: '/inventory', permission: PERMISSIONS.INVENTORY_VIEW, pattern: /^\/inventory(?:[/?#]|$)/ },
  { path: '/costs', permission: PERMISSIONS.COST_VIEW, pattern: /^\/costs(?:[/?#]|$)/ },
  { path: '/accounts', permission: PERMISSIONS.ACCOUNT_VIEW, pattern: /^\/accounts(?:[/?#]|$)/ },
  { path: '/customers', permission: PERMISSIONS.CUSTOMER_VIEW, pattern: /^\/customers(?:[/?#]|$)/ },
  { path: '/suppliers', permission: PERMISSIONS.SUPPLIER_VIEW, pattern: /^\/suppliers(?:[/?#]|$)/ },
  { path: '/reconciliation', permission: PERMISSIONS.RECONCILIATION_VIEW, pattern: /^\/reconciliation(?:[/?#]|$)/ },
  { path: '/import', permission: PERMISSIONS.IMPORT_VIEW, pattern: /^\/import(?:[/?#]|$)/ },
  { path: '/performance/import', permission: PERMISSIONS.PERFORMANCE_IMPORT_VIEW, pattern: /^\/performance\/import(?:[/?#]|$)/ },
  { path: '/performance/purchase-commission', permission: PERMISSIONS.PURCHASE_COMMISSION_VIEW, pattern: /^\/performance\/purchase-commission(?:[/?#]|$)/ },
  { path: '/performance', permission: PERMISSIONS.PERFORMANCE_VIEW, pattern: /^\/performance(?:[/?#]|$)/ },
  { path: '/system/salary-rules', permission: PERMISSIONS.SALARY_RULE_VIEW, pattern: /^\/system\/salary-rules(?:[/?#]|$)/ },
  { path: '/payroll', permission: PERMISSIONS.PAYROLL_VIEW, pattern: /^\/payroll(?:[/?#]|$)/ },
  { path: '/employees', permission: PERMISSIONS.EMPLOYEE_VIEW, pattern: /^\/employees(?:[/?#]|$)/ },
  { path: '/system/templates', permission: PERMISSIONS.SYSTEM_VIEW, pattern: /^\/system\/templates(?:[/?#]|$)/ },
  { path: '/system/classify-rules', permission: PERMISSIONS.CLASSIFY_RULE_VIEW, pattern: /^\/system\/classify-rules(?:[/?#]|$)/ },
  { path: '/system/wechat-bindings', permission: PERMISSIONS.WECHAT_VIEW, pattern: /^\/system\/wechat-bindings(?:[/?#]|$)/ },
  { path: '/system/logs', permission: PERMISSIONS.AUDIT_VIEW, pattern: /^\/system\/logs(?:[/?#]|$)/ }
])

function containsAsciiControlCharacter(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

export function normalizeLocalRedirect(rawRedirect) {
  if (typeof rawRedirect !== 'string') return ''
  const redirect = rawRedirect.trim()
  if (!redirect.startsWith('/') || redirect.startsWith('//')) return ''
  const pathOnly = redirect.split(/[?#]/, 1)[0]
  let decodedPath = pathOnly
  try {
    // 最多解码三轮，拦截 %252f、%252e%252e 等多层编码绕过。
    for (let index = 0; index < 3; index += 1) {
      const next = decodeURIComponent(decodedPath)
      if (next === decodedPath) break
      decodedPath = next
    }
  } catch {
    return ''
  }

  if (!decodedPath.startsWith('/') || decodedPath.startsWith('//')) return ''
  if (decodedPath.includes('\\') || containsAsciiControlCharacter(decodedPath)) return ''
  if (decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) return ''
  if (/^\/(?:login|sso\/(?:initiate|callback)|forbidden)(?:[/?#]|$)/.test(decodedPath)) return ''
  return redirect
}

export function resolvePostAuthRedirect(userStore, rawRedirect) {
  const requested = normalizeLocalRedirect(rawRedirect)
  if (requested) {
    const destination = AUTHORIZED_DESTINATIONS.find((item) => item.pattern.test(requested))
    if (destination && userStore.can(destination.permission)) return requested
  }

  return AUTHORIZED_DESTINATIONS.find(
    (item) => item.fallback !== false && userStore.can(item.permission)
  )?.path || '/forbidden'
}

export { AUTHORIZED_DESTINATIONS }
