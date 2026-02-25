import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // Verify caller is company_admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Check company_admin role
    const { data: roleCheck } = await callerClient.rpc('has_role', {
      _user_id: caller.id, _role: 'company_admin'
    })
    if (!roleCheck) {
      return new Response(JSON.stringify({ error: 'Forbidden: company_admin required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { email, password, name, slug, role, bio } = await req.json()

    if (!email || !password || !name || !slug || !role) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Use service role client for admin operations
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // 1. Create auth user
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    })
    if (createError) {
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const userId = newUser.user.id

    // 2. Update profile with expert_slug
    await adminClient.from('profiles').update({
      display_name: name,
      expert_slug: slug,
    }).eq('user_id', userId)

    // 3. Insert analyst role
    await adminClient.from('user_roles').insert({
      user_id: userId,
      role: 'analyst'
    })

    // 4. Insert expert record
    const { data: expert, error: expertError } = await adminClient.from('experts').insert({
      user_id: userId,
      slug,
      name,
      role,
      bio: bio || null,
      created_by: caller.id,
    }).select().single()

    if (expertError) {
      return new Response(JSON.stringify({ error: expertError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 5. Audit log
    await adminClient.from('audit_logs').insert({
      actor_id: caller.id,
      action: 'create_analyst',
      target_type: 'expert',
      target_id: expert.id,
      detail: { email, name, slug, role }
    })

    return new Response(JSON.stringify({ success: true, expert }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
