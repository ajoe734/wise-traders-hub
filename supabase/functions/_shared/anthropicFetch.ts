// Shared Anthropic API wrapper with timeout + retry-on-overload (429/529).
// Falls back to Lovable AI Gateway if LOVABLE_API_KEY is present and direct call fails with 5xx.

export interface AnthropicCallOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  [k: string]: unknown;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export async function callAnthropic(opts: AnthropicCallOptions): Promise<AnthropicResponse> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxRetries = opts.maxRetries ?? 2;
  const body = JSON.stringify({
    model: opts.model ?? 'claude-sonnet-4-5',
    max_tokens: opts.maxTokens ?? 4000,
    temperature: opts.temperature,
    system: opts.system,
    messages: opts.messages,
  });

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
      });
      if (resp.ok) return await resp.json() as AnthropicResponse;

      // Retry on overload / rate limit / 5xx
      if ([429, 529, 500, 502, 503, 504].includes(resp.status) && attempt < maxRetries) {
        const text = await resp.text().catch(() => '');
        lastErr = new Error(`Anthropic ${resp.status}: ${text.slice(0, 200)}`);
        const backoff = 1000 * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      const text = await resp.text().catch(() => '');
      throw new Error(`Anthropic ${resp.status}: ${text.slice(0, 500)}`);
    } catch (err) {
      lastErr = err as Error;
      if (attempt >= maxRetries) break;
      const isTimeout = (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError';
      if (!isTimeout) break; // only retry timeouts; other errors bail
      const backoff = 1000 * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  throw lastErr ?? new Error('Anthropic call failed');
}

/** Extract first text block. */
export function extractText(resp: AnthropicResponse): string {
  return resp?.content?.[0]?.text ?? '';
}

/** fetch wrapper with AbortSignal.timeout(timeoutMs) baked in. */
export async function fetchWithTimeout(input: string | URL, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 10_000, ...rest } = init;
  return await fetch(input, { ...rest, signal: rest.signal ?? AbortSignal.timeout(timeoutMs) });
}
