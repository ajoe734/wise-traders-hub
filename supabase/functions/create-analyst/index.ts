// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { validateInput, validationJsonResponse } from '../_shared/inputValidator.ts';

Deno.serve(withLogging('create-analyst', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // AUTH: company_admin (unified contract — see _shared/adminGuard.ts)
    try {
      await requireCompanyAdmin(req)
    } catch (e) {
      return authErrorResponse(e, req)
    }

    const reqBody = await req.json()
    const issues = validateInput({
      fields: {
        email: { required: true, type: 'string', label: 'email', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
        password: { required: true, type: 'string', label: 'password', minLength: 8 },
        name: { required: true, type: 'string', label: 'name', minLength: 1 },
        slug: { required: true, type: 'string', label: 'slug', pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, hint: '只能包含小寫英文、數字和連字號（-）' },
        role: { required: true, type: 'string', label: 'role', oneOf: ['mentor', 'analyst', 'advisor'] },
        bio: { required: false, type: 'string', label: 'bio' },
      },
      source: reqBody,
    })
    if (issues.length) return validationJsonResponse(issues)
    const { email, password, name, slug, role, bio } = reqBody

    const adminClient = serviceClient()

    // 1. Create or find auth user
    let userId: string
    let createdNewAuthUser = false
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    })
    if (createError) {
      const msg = (createError.message || '').toLowerCase()
      const alreadyExists = msg.includes('already') || msg.includes('registered') || msg.includes('exists')
      if (!alreadyExists) {
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      const { data: list } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const found = list?.users?.find((u: any) => (u.email || '').toLowerCase() === email.toLowerCase())
      if (!found) {
        return new Response(JSON.stringify({ error: '此 Email 已被註冊，但查不到帳號資料' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      userId = found.id
      // 既有用戶：同步更新密碼（管理員行為 = 授權重設）
      await adminClient.auth.admin.updateUserById(userId, { password })
    } else {
      userId = newUser!.user.id
      createdNewAuthUser = true
    }

    // 2. slug 衝突檢查（同 slug 屬於別的 user）
    const { data: slugOwner } = await adminClient
      .from('experts')
      .select('id, user_id, name')
      .eq('slug', slug)
      .maybeSingle()
    if (slugOwner && slugOwner.user_id !== userId) {
      if (createdNewAuthUser) {
        try { await adminClient.auth.admin.deleteUser(userId) } catch (_) {}
      }
      return new Response(JSON.stringify({ error: `Slug「${slug}」已被 ${slugOwner.name} 使用，請換一個` }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 3. 檢查現有 expert row（同 user_id）
    const { data: existingExpert } = await adminClient
      .from('experts')
      .select('id, slug, status')
      .eq('user_id', userId)
      .maybeSingle()

    if (existingExpert && existingExpert.status === 'active') {
      return new Response(JSON.stringify({
        error: `此 Email 已是啟用中分析師（slug: ${existingExpert.slug}），請至分析師頁使用「停用/編輯」`,
        expert_id: existingExpert.id,
      }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      // 4. profile 更新
      const { error: profileError } = await adminClient.from('profiles').update({
        display_name: name,
        expert_slug: slug,
      }).eq('user_id', userId)
      if (profileError) throw profileError

      // 5. user_roles 冪等 upsert analyst
      const { error: roleError } = await adminClient.from('user_roles')
        .upsert({ user_id: userId, role: 'analyst' }, { onConflict: 'user_id,role' })
      if (roleError) throw roleError

      // 6. experts insert 或 update（adopt）
      let expert: any
      let adopted = false
      if (existingExpert) {
        const { data: updated, error: updErr } = await adminClient.from('experts').update({
          slug,
          name,
          role,
          bio: bio || null,
          status: 'suspended',
          created_by: caller.id,
        }).eq('id', existingExpert.id).select().single()
        if (updErr) throw updErr
        expert = updated
        adopted = true
      } else {
        const { data: inserted, error: expertError } = await adminClient.from('experts').insert({
          user_id: userId,
          slug,
          name,
          role,
          bio: bio || null,
          created_by: caller.id,
          status: 'suspended',
        }).select().single()
        if (expertError) throw expertError
        expert = inserted
      }

      // 7. 預設方案（若尚無任何方案才建立，避免重複）
      const { count: planCount } = await adminClient
        .from('expert_plans')
        .select('id', { count: 'exact', head: true })
        .eq('expert_id', expert.id)
      if ((planCount || 0) === 0) {
        const planDefaults = role === 'advisor'
          ? {
              plan_type: 'analyst_signal_l1',
              name: '跟單派',
              description: '即時訊號通知，每日操作建議',
              price_monthly: 1699,
              price_yearly: 16990,
              features: ['即時訊號推播通知', '完整買賣理由說明', '風險與部位控管建議', '交易紀錄完整保存'],
            }
          : {
              plan_type: 'mentor_weekly_journal',
              name: '修煉派',
              description: '每週操盤週記與教學',
              price_monthly: 799,
              price_yearly: 7990,
              features: ['T+7 延遲實戰週記', '完整操作邏輯拆解', '事後檢討與學習重點', '策略思維培養'],
            }
        await adminClient.from('expert_plans').insert({
          expert_id: expert.id,
          ...planDefaults,
          is_active: true,
        })
      }

      await adminClient.from('audit_logs').insert({
        actor_id: caller.id,
        action: adopted ? 'adopt_analyst' : 'create_analyst',
        target_type: 'expert',
        target_id: expert.id,
        detail: { email, name, slug, role, adopted, existing_user: !createdNewAuthUser }
      })

      return new Response(JSON.stringify({ success: true, expert, adopted, expert_id: expert.id }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (stepError: any) {
      console.error('create-analyst partial failure, rolling back:', stepError)
      try {
        if (createdNewAuthUser) {
          await adminClient.auth.admin.deleteUser(userId)
        } else if (!existingExpert) {
          // 升級既有用戶且原本沒 expert row → 清理本次新增
          await adminClient.from('experts').delete().eq('user_id', userId)
        }
        // 有 existingExpert 時不清 user_roles（可能本來就有），也不動 expert row（update 已 partial 或未動）
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr)
      }
      return new Response(JSON.stringify({ error: stepError.message || '建立分析師失敗，已回滾' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}))
