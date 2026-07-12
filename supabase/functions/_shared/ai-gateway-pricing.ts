// 粗略 USD per 1M tokens 估價（實際扣款以 Lovable AI Gateway 為準）。
// 更新時請對照 https://ai.gateway.lovable.dev/pricing 或最新公告。
const PRICE_TABLE: Record<string, { input: number; output: number }> = {
  'openai/gpt-5': { input: 1.25, output: 10 },
  'openai/gpt-5-mini': { input: 0.25, output: 2 },
  'openai/gpt-5-nano': { input: 0.05, output: 0.4 },
  'openai/gpt-5.2': { input: 1.25, output: 10 },
  'openai/gpt-5.4': { input: 2.5, output: 20 },
  'openai/gpt-5.4-mini': { input: 0.5, output: 4 },
  'openai/gpt-5.4-nano': { input: 0.1, output: 0.8 },
  'openai/gpt-5.5': { input: 2.5, output: 20 },
  'google/gemini-2.5-pro': { input: 1.25, output: 10 },
  'google/gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'google/gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'google/gemini-3.1-flash-lite': { input: 0.1, output: 0.4 },
  'google/gemini-3.5-flash': { input: 0.3, output: 2.5 },
  'openai/text-embedding-3-small': { input: 0.02, output: 0 },
};

export function estimateCostUsd(model: string, promptTokens?: number | null, completionTokens?: number | null): number | null {
  const p = PRICE_TABLE[model];
  if (!p) return null;
  const inTok = promptTokens ?? 0;
  const outTok = completionTokens ?? 0;
  return Number(((inTok / 1_000_000) * p.input + (outTok / 1_000_000) * p.output).toFixed(6));
}
