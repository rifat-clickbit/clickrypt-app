// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { Redis } from 'https://esm.sh/@upstash/redis@1.34.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const getEnv = (key: string): string => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = getEnv('SUPABASE_URL');
    const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    const upstashUrl = getEnv('UPSTASH_REDIS_REST_URL');
    const upstashToken = getEnv('UPSTASH_REDIS_REST_TOKEN');

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      token
    );
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: authError?.message }),
        { status: 401, headers: corsHeaders }
      );
    }

    const redis = new Redis({ url: upstashUrl, token: upstashToken });
    const cacheKey = `activity:${user.id}`;

    const cached = await redis.get<string>(cacheKey);
    if (cached) {
      return new Response(cached, { status: 200, headers: corsHeaders });
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    // activity_logs.user_id references public.users.id, not the auth UUID,
    // so resolve the users row from the auth token first.
    const { data: userRow } = await serviceClient
      .from('users')
      .select('id')
      .eq('auth_id', user.id)
      .maybeSingle();

    const targetUserId = userRow?.id || user.id;

    const { data: dbLogs = [] } = await serviceClient
      .from('activity_logs')
      .select('*')
      .eq('user_id', targetUserId)
      .order('timestamp', { ascending: false })
      .limit(50);

    const formatted = (dbLogs as any[]).map((l: any) => ({
      id: l.id,
      userId: l.user_id,
      email: l.email_snapshot,
      title: l.title,
      message: l.message,
      category: l.category,
      mode: l.mode,
      timestamp: l.timestamp,
      isRead: true,
    }));

    const payload = JSON.stringify({ logs: formatted });
    await redis.set(cacheKey, payload, { ex: 30 });

    return new Response(payload, { status: 200, headers: corsHeaders });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal server error' }),
      { status: 500, headers: corsHeaders }
    );
  }
});
