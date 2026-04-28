// 共用輸入驗證模組（Edge Function 用，零依賴）
// 與 src/checkup/lib/edgeSchemas.js 同概念，但獨立寫一份避免跨 import.

export interface FieldSpec {
  required?: boolean;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any';
  acceptTypes?: Array<'string' | 'number' | 'boolean' | 'array' | 'object'>;
  minLength?: number;
  minItems?: number;
  pattern?: RegExp;
  oneOf?: unknown[];
  label?: string;
  altKey?: string;
  example?: string;
  hint?: string;
  coerce?: string;
  nested?: Record<string, FieldSpec>;
}

export interface FieldIssue {
  key: string;
  label: string;
  reason: string;
  example?: string;
  hint?: string;
}

function describeType(value: unknown, type: FieldSpec['type']) {
  if (value === undefined || value === null || value === '') return 'missing';
  if (type === 'array') return Array.isArray(value) ? 'ok' : 'wrong-type';
  if (type === 'object') return value && typeof value === 'object' && !Array.isArray(value) ? 'ok' : 'wrong-type';
  if (type === 'string') return typeof value === 'string' ? 'ok' : 'wrong-type';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value) ? 'ok' : 'wrong-type';
  if (type === 'boolean') return typeof value === 'boolean' ? 'ok' : 'wrong-type';
  return 'ok';
}

function typeMatches(value: unknown, spec: FieldSpec) {
  if (describeType(value, spec.type) === 'ok') return true;
  if (Array.isArray(spec.acceptTypes)) {
    for (const t of spec.acceptTypes) {
      if (describeType(value, t) === 'ok') return true;
    }
  }
  return false;
}

function buildIssue(key: string, label: string, reason: string, spec?: FieldSpec): FieldIssue {
  return { key, label, reason, example: spec?.example, hint: spec?.hint };
}

function validateField(key: string, spec: FieldSpec, source: any): FieldIssue[] {
  const direct = source?.[key];
  const alt = spec.altKey ? source?.[spec.altKey] : undefined;
  const value = direct !== undefined ? direct : alt;
  const issues: FieldIssue[] = [];
  const label = spec.label || key;

  const status = describeType(value, spec.type);
  if (status === 'missing') {
    if (spec.required) issues.push(buildIssue(key, label, '缺少必填欄位', spec));
    return issues;
  }
  if (status === 'wrong-type' && !typeMatches(value, spec)) {
    issues.push(buildIssue(key, label, `型別錯誤（需要 ${spec.type}）`, spec));
    return issues;
  }
  if (spec.type === 'string' && spec.minLength != null && ((value as string)?.trim?.().length || 0) < spec.minLength) {
    issues.push(buildIssue(key, label, `長度需 ≥ ${spec.minLength}`, spec));
  }
  if (spec.type === 'array' && spec.minItems != null && Array.isArray(value) && (value as unknown[]).length < spec.minItems) {
    issues.push(buildIssue(key, label, `至少 ${spec.minItems} 筆`, spec));
  }
  if (spec.type === 'string' && spec.pattern && typeof value === 'string' && !spec.pattern.test(value)) {
    issues.push(buildIssue(key, label, '格式不正確', spec));
  }
  if (spec.oneOf && !spec.oneOf.includes(value)) {
    issues.push(buildIssue(key, label, `值需為 ${spec.oneOf.join(' / ')}`, spec));
  }
  if (spec.type === 'object' && spec.nested) {
    for (const [nKey, nSpec] of Object.entries(spec.nested)) {
      issues.push(...validateField(nKey, nSpec, value));
    }
  }
  return issues;
}

export function validateInput(opts: { fields: Record<string, FieldSpec>; source: any }): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const [key, spec] of Object.entries(opts.fields)) {
    issues.push(...validateField(key, spec, opts.source || {}));
  }
  return issues;
}

export function validationResponse(fields: FieldIssue[], corsHeaders: Record<string, string>) {
  const summary = fields
    .map((f) => {
      const parts = [f.label + '：' + f.reason];
      if (f.example) parts.push('範例 ' + f.example);
      return parts.join('（') + (f.example ? '）' : '');
    })
    .join('；');
  return new Response(
    JSON.stringify({
      error: 'VALIDATION_ERROR',
      message: `參數驗證失敗：${summary}`,
      fields,
    }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
