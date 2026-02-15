import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response("Missing Supabase env", { status: 500, headers: corsHeaders });
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response("Missing VAPID keys", { status: 500, headers: corsHeaders });
    }

    const body = await req.json();
    const toUserId = body?.to_user_id;
    const title = body?.title || "Walking Tours";
    const message = body?.body || "";
    const data = body?.data || {};

    if (!toUserId) {
      return new Response("Missing recipient", { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: subs, error: subsError } = await supabase
      .from("push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("user_id", toUserId);

    if (subsError) {
      return new Response(subsError.message, { status: 500, headers: corsHeaders });
    }

    if (!subs || subs.length === 0) {
      return new Response("No subscriptions", { status: 200, headers: corsHeaders });
    }

    const { default: webpush } = await import("https://esm.sh/web-push@3.6.7?target=deno&bundle");
    webpush.setVapidDetails("mailto:admin@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    // Supabase Edge runtime lacks crypto.ECDH used by encrypted payloads.
    // Keep push payload empty so delivery still works.
    const payload = undefined;

    let sent = 0;
    let failed = 0;
    let removed = 0;
    const errors: string[] = [];

    for (const sub of subs) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        }, payload);
        sent += 1;
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
        console.error("push send error", msg);
        const status = err?.statusCode || err?.status || 0;
        if (status === 404 || status === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          removed += 1;
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent, failed, removed, total: subs.length, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-push fatal", err);
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return new Response(message, { status: 500, headers: corsHeaders });
  }
});
