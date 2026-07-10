// Lovable AI Gateway helper for the AI SDK (OpenAI-compatible provider).
// Used by expert-ai-chat / expert-ai-index for chat streaming and embeddings.
import { createOpenAICompatible } from 'npm:@ai-sdk/openai-compatible@^1.0.0';

const LOVABLE_AIG_RUN_ID_HEADER = 'X-Lovable-AIG-Run-ID';

export function createLovableAiGatewayRunIdFetch(initialRunId?: string) {
  let runId = initialRunId?.trim() || undefined;
  let resolveRunId: (v: string | undefined) => void = () => {};
  let resolved = false;
  const ready = new Promise<string | undefined>((r) => { resolveRunId = r; });
  const publish = (v?: string) => {
    const next = v?.trim() || undefined;
    if (!runId && next) runId = next;
    if (!resolved) { resolved = true; resolveRunId(runId); }
  };
  if (runId) publish(runId);
  return {
    fetch: async (input: any, init?: any) => {
      const headers = new Headers(init?.headers);
      if (runId && !headers.has(LOVABLE_AIG_RUN_ID_HEADER)) headers.set(LOVABLE_AIG_RUN_ID_HEADER, runId);
      try {
        const response = await fetch(input, { ...init, headers });
        publish(response.headers.get(LOVABLE_AIG_RUN_ID_HEADER) ?? undefined);
        return response;
      } catch (e) { publish(undefined); throw e; }
    },
    getRunId: () => runId,
    waitForRunId: () => (runId ? Promise.resolve(runId) : ready),
  };
}

export function createLovableAiGatewayProvider(apiKey: string, initialRunId?: string) {
  const runIdFetch = createLovableAiGatewayRunIdFetch(initialRunId);
  const provider = createOpenAICompatible({
    name: 'lovable',
    baseURL: 'https://ai.gateway.lovable.dev/v1',
    headers: {
      'Lovable-API-Key': apiKey,
      'X-Lovable-AIG-SDK': 'vercel-ai-sdk',
    },
    fetch: runIdFetch.fetch as any,
  });
  return Object.assign(provider, {
    getRunId: runIdFetch.getRunId,
    waitForRunId: runIdFetch.waitForRunId,
  });
}

// Direct embedding call (bypasses AI SDK — simpler for one-shot vectorization).
export async function embedText(apiKey: string, text: string, model = 'openai/text-embedding-3-small'): Promise<number[]> {
  const resp = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
    method: 'POST',
    headers: {
      'Lovable-API-Key': apiKey,
      'Content-Type': 'application/json',
      'X-Lovable-AIG-SDK': 'raw',
    },
    body: JSON.stringify({ model, input: text }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Embedding failed ${resp.status}: ${txt}`);
  }
  const data = await resp.json();
  return data.data[0].embedding as number[];
}
