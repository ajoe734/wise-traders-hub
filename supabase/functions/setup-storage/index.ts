// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { corsHeaders } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
serve(withLogging('setup-storage', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Create avatars bucket if it doesn't exist
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets?.some(b => b.id === 'avatars');
    
    if (!exists) {
      const { error } = await supabase.storage.createBucket('avatars', {
        public: true,
        fileSizeLimit: 5242880,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      });
      if (error) throw error;
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}));
