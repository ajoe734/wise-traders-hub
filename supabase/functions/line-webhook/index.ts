import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { lineWebhookVerifySignature as verifySignature } from '../_shared/paymentVerify.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply'

async function replyMessage(replyToken: string, channelAccessToken: string, text: string) {
  await fetch(LINE_REPLY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // LINE webhook sends GET for verification
  if (req.method === 'GET') {
    return new Response('OK', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const expertId = url.searchParams.get('expert_id')

    if (!expertId) {
      return new Response(JSON.stringify({ error: 'Missing expert_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Read raw body first — needed for X-Line-Signature verification
    const rawBody = await req.text()
    const lineSignature = req.headers.get('x-line-signature')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Get channel config + expert name for this expert
    const [{ data: channel }, { data: expert }] = await Promise.all([
      supabase
        .from('expert_line_channels')
        .select('channel_access_token, channel_secret, is_active')
        .eq('expert_id', expertId)
        .single(),
      supabase
        .from('experts')
        .select('name')
        .eq('id', expertId)
        .single(),
    ])

    const expertName = expert?.name || '分析師'

    if (!channel || !channel.is_active) {
      console.error('No active LINE channel for expert:', expertId)
      return new Response(JSON.stringify({ ok: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify X-Line-Signature before processing any events
    if (!channel.channel_secret || !await verifySignature(rawBody, lineSignature, channel.channel_secret)) {
      console.error('LINE webhook signature verification failed for expert:', expertId)
      return new Response('Unauthorized', {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = JSON.parse(rawBody)
    const events = body.events || []

    for (const event of events) {
      const lineUserId = event.source?.userId
      if (!lineUserId) continue

      // Handle text message - check for binding code
      if (event.type === 'message' && event.message?.type === 'text' && event.replyToken) {
        const rawText = event.message.text.trim().toUpperCase()

        // Only treat 6-char alphanumeric strings as binding codes; ignore everything else
        const isBindingCode = /^[A-Z0-9]{6}$/.test(rawText)
        if (!isBindingCode) {
          // Not a binding code — silently ignore normal chat messages
          continue
        }

        // ISSUE-009: First check if code exists for ANY expert (to detect wrong OA)
        const { data: anyCode } = await supabase
          .from('line_binding_codes')
          .select('expert_id')
          .eq('code', rawText)
          .eq('used', false)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle()

        if (anyCode && anyCode.expert_id !== expertId) {
          await replyMessage(
            event.replyToken,
            channel.channel_access_token,
            '此驗證碼不屬於本頻道，請確認您傳送到正確的 LINE 官方帳號。',
          )
          continue
        }

        // Look up valid binding code for this expert
        const { data: bindingCode } = await supabase
          .from('line_binding_codes')
          .select('*')
          .eq('code', rawText)
          .eq('expert_id', expertId)
          .eq('used', false)
          .gt('expires_at', new Date().toISOString())
          .single()

        if (!bindingCode) {
          await replyMessage(
            event.replyToken,
            channel.channel_access_token,
            '驗證碼無效或已過期，請重新取得驗證碼。',
          )
          continue
        }

        // Check if already bound
        const { data: existingBinding } = await supabase
          .from('member_line_bindings')
          .select('id')
          .eq('user_id', bindingCode.user_id)
          .eq('expert_id', expertId)
          .single()

        if (existingBinding) {
          // Update existing binding
          await supabase
            .from('member_line_bindings')
            .update({
              line_user_id: lineUserId,
              display_name: event.source?.displayName || null,
              is_active: true,
              bound_at: new Date().toISOString(),
            })
            .eq('id', existingBinding.id)
        } else {
          // Create new binding
          await supabase
            .from('member_line_bindings')
            .insert({
              user_id: bindingCode.user_id,
              expert_id: expertId,
              line_user_id: lineUserId,
              display_name: event.source?.displayName || null,
              is_active: true,
            })
        }

        // Mark code as used
        await supabase
          .from('line_binding_codes')
          .update({ used: true })
          .eq('id', bindingCode.id)

        await replyMessage(
          event.replyToken,
          channel.channel_access_token,
          `✅ 綁定成功！您將會收到${expertName}的即時訊號通知。`,
        )
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('line-webhook error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
