// 持倉看板 18 支 Edge Function 的輸入規格 — 前後端唯一可信來源
// 改動 function 時，請同步更新這裡
//
// 結構：
//   FN_NAME: {
//     method: 'GET' | 'POST',
//     query?: { 欄位: { required, type, pattern?, oneOf?, label } },
//     body?: 與 query 相同；或 actions: { 'action-name': { 欄位... } } 用於 dispatch 型 function
//     auth?: 'jwt' (需要使用者登入) | 'none'
//   }

const REQ = (type, opts = {}) => ({ required: true, type, ...opts })
const OPT = (type, opts = {}) => ({ required: false, type, ...opts })

export const EDGE_SCHEMAS = {
  // ── AI 分析 ──────────────────────────────────────────────
  'checkup-analyze': {
    method: 'POST',
    body: {
      userPrompt: REQ('string', { minLength: 4, label: 'userPrompt（或 prompt）', altKey: 'prompt' }),
      systemPrompt: OPT('string', { label: 'systemPrompt' }),
    },
  },

  'checkup-parse': {
    method: 'POST',
    body: {
      base64: REQ('string', { minLength: 32, label: '截圖 base64' }),
      mediaType: OPT('string', { label: 'mediaType', default: 'image/jpeg' }),
      systemPrompt: OPT('string', { label: 'systemPrompt' }),
    },
  },

  'checkup-calendar': {
    method: 'POST',
    body: {
      stocks: REQ('array', { label: 'stocks 陣列' }),
      today: OPT('string', { label: 'today YYYY/MM/DD' }),
      endDate: OPT('string', { label: 'endDate YYYY/MM/DD' }),
      debug: OPT('boolean'),
    },
  },

  'checkup-predict-events': {
    method: 'POST',
    body: {
      events: REQ('array', { minItems: 1, label: 'events 陣列（至少 1 筆）' }),
      holdings: OPT('array'),
      debug: OPT('boolean'),
    },
  },

  // ── Research（dispatch 型）──────────────────────────────
  'checkup-research': {
    method: 'POST',
    auth: 'jwt',
    actions: {
      'deep-research': {
        action: REQ('string'),
        code: REQ('string', { pattern: /^\d{4,6}[A-Z]?$/i, label: '股票代碼' }),
        name: REQ('string', { label: '股票名稱' }),
        dossier: OPT('object'),
        brain: OPT('object'),
      },
      'system-review': {
        action: REQ('string'),
        holdings: OPT('array'),
        brain: OPT('object'),
        researchHistory: OPT('array'),
      },
      'get-history': {
        action: REQ('string'),
      },
    },
  },

  'checkup-research-extract': {
    method: 'POST',
    body: {
      report: REQ('object', {
        label: 'report',
        nested: {
          code: REQ('string', { pattern: /^\d{4,6}[A-Z]?$/i, label: 'report.code' }),
          text: REQ('string', { minLength: 10, label: 'report.text' }),
        },
      }),
      stock: OPT('object'),
      dossier: OPT('object'),
    },
  },

  // ── Brain（dispatch 型）─────────────────────────────────
  'checkup-brain': {
    method: 'BOTH',
    get: {
      action: REQ('string', { oneOf: ['brain', 'history', 'all'], label: 'action' }),
    },
    actions: {
      'save-brain': { action: REQ('string'), data: REQ('any', { label: 'data') } },
      'save-analysis': { action: REQ('string'), data: REQ('any') },
      'save-events': { action: REQ('string'), data: REQ('array') },
      'load-events': { action: REQ('string') },
      'delete-analysis': { action: REQ('string'), data: REQ('any') },
      'save-holdings': { action: REQ('string'), data: REQ('array') },
      'get-holdings': { action: REQ('string') },
      'get-brain': { action: REQ('string') },
      'get-analysis-history': { action: REQ('string') },
      'get-research-history': { action: REQ('string') },
      'save-research-history': { action: REQ('string'), data: REQ('array') },
    },
  },

  // ── Knowledge（dispatch 型）─────────────────────────────
  'checkup-knowledge': {
    method: 'BOTH',
    get: {
      action: REQ('string', { oneOf: ['search', 'similar', 'stats'], label: 'action' }),
      q: OPT('string', { label: 'q（action=search 必填）' }),
      category: OPT('string'),
      stockId: OPT('string', { label: 'stockId（action=similar 必填）' }),
    },
    actions: {
      add: {
        action: REQ('string'),
        category: REQ('string'),
        item: REQ('object'),
      },
    },
  },

  // ── Telemetry ──────────────────────────────────────────
  'checkup-telemetry': {
    method: 'BOTH',
    get: {},
    actions: {
      'capture-diagnostics': {
        action: REQ('string'),
        data: REQ('object', { label: 'data（含 entries 陣列）' }),
      },
    },
  },

  // ── Reports & Data（GET 為主）──────────────────────────
  'checkup-report': {
    method: 'GET',
    auth: 'jwt',
    query: {},
  },

  'checkup-analyst-reports': {
    method: 'POST',
    body: {
      code: REQ('string', { pattern: /^\d{4,6}[A-Z]?$/i, label: '股票代碼' }),
      name: OPT('string'),
      knownHashes: OPT('array'),
      maxItems: OPT('number'),
      maxExtract: OPT('number'),
    },
  },

  'checkup-twse': {
    method: 'GET',
    query: {
      ex_ch: REQ('string', { minLength: 3, label: 'ex_ch（如 tse_2330.tw）' }),
    },
  },

  'checkup-institutional': {
    method: 'GET',
    query: {
      date: OPT('string', { label: 'date YYYYMMDD（可省，預設今天）' }),
    },
  },

  'checkup-mops-announcements': {
    method: 'GET',
    query: {
      date: OPT('string', { label: 'date YYYYMMDD' }),
    },
  },

  'checkup-mops-revenue': {
    method: 'GET',
    query: {
      stockId: REQ('string', { pattern: /^\d{4,6}[A-Z]?$/i, label: 'stockId' }),
      year: OPT('string'),
      month: OPT('string'),
    },
  },

  'checkup-sparkline': {
    method: 'POST',
    body: {
      codes: REQ('array', { minItems: 1, label: 'codes 陣列' }),
    },
  },

  // ── Stock name lookup ──────────────────────────────────
  'stock-name-lookup': {
    method: 'POST',
    body: {
      symbols: REQ('array', { minItems: 1, label: 'symbols 陣列' }),
    },
  },
}
