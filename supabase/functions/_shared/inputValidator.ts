// 共用輸入驗證模組（Edge Function 用，零依賴）
// 與 src/checkup/lib/edgeSchemas.js 同概念，但獨立寫一份避免跨 import.
//
// 用法：
//   import { validateInput, validationResponse } from '../_shared/inputValidator.ts'
//   const issues = validateInput({
//     fields: {
//       userPrompt: { required: true, type: 'string', minLength: 4, label: 'userPrompt', altKey: 'prompt' }
//     },
//     source: body,
//   })
//   if (issues.length) return validationResponse(issues, corsHeaders)

export interface FieldSpec {
  required?: boolean;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any';
  minLength?: number;
  minItems?: number;
  pattern?: RegExp;
  oneOf?: unknown[];
  label?: string;
  altKey?: string;
  nested?: Record<string, FieldSpec>;
}

export interface FieldIssue {
  key: string;
  label: string;
  reason: string;
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

function validateField(key: string, spec: FieldSpec, source: any): FieldIssue[] {
  const direct = source?.[key];
  const alt = spec.altKey ? source?.[spec.altKey] : undefined;
  const value = direct !== undefined ? direct : alt;
  const issues: FieldIssue[] = [];
  const label = spec.label || key;

  const status = describeType(value, spec.type);
  if (status === 'missing') {
    if (spec.required) issues.push({ key, label, reason: '缺少必填欄位' });
    return issues;
  }
  if (status === 'wrong-type') {
    issues.push({ key, label, reason: `型別錯誤（需要 ${spec.type}）` });
    return issues;
  }
  if (spec.type === 'string' && spec.minLength != null && (value as string).trim().length < spec.minLength) {
    issues.push({ key, label, reason: `長度需 ≥ ${spec.minLength}` });
  }
  if (spec.type === 'array' && spec.minItems != null && (value as unknown[]).length < spec.minItems) {
    issues.push({ key, label, reason: `至少 ${spec.minItems} 筆` });
  }
  if (spec.type === 'string' && spec.pattern && !spec.pattern.test(value as string)) {
    issues.push({ key, label, reason: '格式不正確' });
  }
  if (spec.oneOf && !spec.oneOf.includes(value)) {
    issues.push({ key, label, reason: `值需為 ${spec.oneOf.join(' / ')}` });
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
  return new Response(
    JSON.stringify({
      error: 'VALIDATION_ERROR',
      message: `參數驗證失敗：${fields.map((f) => f.label).join('、')}`,
      fields,
    }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
