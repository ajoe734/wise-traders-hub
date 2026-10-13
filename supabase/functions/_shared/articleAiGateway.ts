// Lovable AI Gateway 呼叫（教學文章 AI 輔助專用）：Responses 串流 JSON、圖片編輯串流。
const BASE = 'https://ai.gateway.lovable.dev/v1';
export const TEXT_MODEL = 'openai/gpt-6-astra';
export const IMAGE_MODEL = 'openai/gpt-image-2.5-sunburst';

export class GatewayError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function readSse(res: Response, onEvent: (type: string, data: any) => void) {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
      let ev = ''; const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      const raw = data.join('\n');
      if (!raw || raw === '[DONE]') continue;
      try { const j = JSON.parse(raw); onEvent(ev || j.type || '', j); } catch { /* ignore */ }
    }
  }
}

async function failOf(res: Response): Promise<GatewayError> {
  const t = await res.text().catch(() => '');
  let msg = t.slice(0, 300);
  try { msg = JSON.parse(t)?.error?.message ?? JSON.parse(t)?.message ?? msg; } catch { /* keep */ }
  return new GatewayError(res.status, msg || `AI ${res.status}`);
}

/** Responses API 串流，strict json_schema；回傳解析後物件 */
export async function responsesJson<T>(apiKey: string, opts: {
  instructions: string; content: unknown[]; schemaName: string; schema: Record<string, unknown>;
}): Promise<T> {
  const res = await fetch(`${BASE}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Lovable-AIG-SDK': 'fetch' },
    body: JSON.stringify({
      model: TEXT_MODEL,
      instructions: opts.instructions,
      input: [{ role: 'user', content: opts.content }],
      reasoning: { effort: 'low' },
      store: false,
      stream: true,
      text: { format: { type: 'json_schema', name: opts.schemaName, strict: true, schema: opts.schema } },
    }),
  });
  if (!res.ok || !res.body) throw await failOf(res);
  let text = ''; let err: string | null = null; let refused = false;
  await readSse(res, (type, d) => {
    if (type === 'response.output_text.delta') text += d.delta ?? '';
    else if (type === 'response.refusal.delta') refused = true;
    else if (type === 'error' || type === 'response.failed') err = d?.error?.message ?? d?.response?.error?.message ?? 'AI 失敗';
  });
  if (err) throw new GatewayError(502, err);
  if (refused || !text.trim()) throw new GatewayError(422, 'AI 拒絕處理此內容');
  return JSON.parse(text) as T;
}

/** 圖片編輯（串流），回傳最終 PNG base64 */
export async function editImagePng(apiKey: string, image: Blob, prompt: string): Promise<string> {
  const form = new FormData();
  form.set('model', IMAGE_MODEL);
  form.set('prompt', prompt);
  form.set('image', new File([image], 'source.png', { type: image.type || 'image/png' }));
  form.set('stream', 'true');
  form.set('partial_images', '1');
  const res = await fetch(`${BASE}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  if (!res.ok || !res.body) throw await failOf(res);
  let final: string | null = null; let err: string | null = null;
  await readSse(res, (type, d) => {
    if (type === 'error') err = d?.error?.message ?? '圖片產生失敗';
    else if ((type === 'image_edit.completed' || type === 'image_generation.completed') && d.b64_json) final = d.b64_json;
  });
  if (err) throw new GatewayError(422, err);
  if (!final) throw new GatewayError(502, '圖片產生未完成');
  return final;
}
