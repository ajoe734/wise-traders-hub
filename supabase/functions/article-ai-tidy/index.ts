// AUTH: user  老師（作者）或管理員：一鍵整理排版，只改格式；字詞不一致即拒絕
import { z } from 'npm:zod@3.23.8';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireExpertOwnerOrAdmin } from '../_shared/adminGuard.ts';
import { AuthError } from '../_shared/authGuard.ts';
import { responsesJson, GatewayError } from '../_shared/articleAiGateway.ts';
import { ARTICLE_AI_LIMITS, quotaExceeded, checkTidy, TIDY_MAX_CHARS, TIDY_SYSTEM_PROMPT, type TidyIn, type TidyOut } from '../_shared/articleAiCore.ts';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Block = z.union([
  z.object({ type: z.literal('text'), text: z.string().max(TIDY_MAX_CHARS) }),
  z.object({ type: z.literal('img'), ref: z.number().int().min(0).max(200) }),
]);
const Body = z.object({ expert_id: z.string().uuid(), blocks: z.array(Block).min(1).max(400) });

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['blocks'],
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['type', 'text', 'items', 'ref'],
        properties: {
          type: { type: 'string', enum: ['h2', 'h3', 'p', 'quote', 'list', 'img'] },
          text: { type: 'string' }, items: { type: 'array', items: { type: 'string' } }, ref: { type: 'integer' },
        },
      },
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'invalid_input', details: parsed.error.flatten().fieldErrors }, 400);
    const { expert_id } = parsed.data;
    const blocks = parsed.data.blocks as TidyIn[];
    const total = blocks.reduce((s, b) => s + (b.type === 'text' ? b.text.length : 0), 0);
    if (total === 0) return json({ error: 'empty' }, 400);
    if (total > TIDY_MAX_CHARS) return json({ error: 'too_long', limit: TIDY_MAX_CHARS }, 400);
    await requireExpertOwnerOrAdmin(req, expert_id);
    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) return json({ error: 'ai_not_configured' }, 500);
    const admin = serviceClient();
    const { data: n, error: qErr } = await admin.rpc('consume_article_ai_quota', { _expert_id: expert_id, _kind: 'tidy', _limit: ARTICLE_AI_LIMITS.tidy });
    if (qErr) throw qErr;
    if (quotaExceeded(n as number)) return json({ error: 'quota_exceeded', limit: ARTICLE_AI_LIMITS.tidy }, 429);

    let out: { blocks: TidyOut[] };
    try {
      out = await responsesJson<{ blocks: TidyOut[] }>(apiKey, {
        instructions: TIDY_SYSTEM_PROMPT,
        content: [{ type: 'input_text', text: JSON.stringify({ blocks }) }],
        schemaName: 'tidy_blocks', schema: SCHEMA,
      });
    } catch (e) {
      await admin.rpc('refund_article_ai_quota', { _expert_id: expert_id, _kind: 'tidy' });
      throw e;
    }
    const verdict = checkTidy(blocks, out.blocks || []);
    if (!verdict.ok) return json({ error: 'guard_rejected', reason: verdict.reason }, 422);
    return json({ blocks: out.blocks });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.code }, e.status);
    if (e instanceof GatewayError) return json({ error: e.status === 402 ? 'ai_credits' : 'ai_failed', message: e.message }, e.status >= 400 && e.status < 600 ? e.status : 502);
    console.error('article-ai-tidy error', e);
    return json({ error: 'internal' }, 500);
  }
});
