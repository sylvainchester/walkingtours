const webpush = require("web-push");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.end(JSON.stringify(body));
}

async function verifyUser(req) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const authHeader = req.headers.authorization || "";
  if (!supabaseUrl || !anon || !authHeader.startsWith("Bearer ")) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anon,
      Authorization: authHeader,
    },
  });

  if (!response.ok) return null;
  const user = await response.json();
  return user?.id || null;
}

async function getSubscriptions(toUserId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(toUserId)}&select=id,endpoint,p256dh,auth`, {
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`subscriptions query failed: ${text}`);
  }
  return response.json();
}

async function removeSubscription(id) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${id}`, {
    method: "DELETE",
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
    },
  });
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    return json(res, 200, { ok: true });
  }
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

  if (!supabaseUrl || !serviceRole || !vapidPublic || !vapidPrivate) {
    return json(res, 500, { ok: false, error: "Missing server env vars" });
  }

  try {
    const callerUserId = await verifyUser(req);
    if (!callerUserId) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }

    const { to_user_id: toUserId, title, body, data } = req.body || {};
    if (!toUserId) {
      return json(res, 400, { ok: false, error: "Missing to_user_id" });
    }

    const subscriptions = await getSubscriptions(toUserId);
    if (!subscriptions.length) {
      return json(res, 200, { ok: true, sent: 0, failed: 0, removed: 0, total: 0, errors: [] });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const payload = JSON.stringify({
      title: title || "Walking Tours",
      body: body || "",
      data: data || { url: "./index.html" },
    });

    let sent = 0;
    let failed = 0;
    let removed = 0;
    const errors = [];

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sent += 1;
      } catch (err) {
        failed += 1;
        const statusCode = err?.statusCode || 0;
        const msg = err?.message || String(err);
        errors.push(msg);
        if (statusCode === 404 || statusCode === 410) {
          removed += 1;
          await removeSubscription(sub.id);
        }
      }
    }

    return json(res, 200, { ok: true, sent, failed, removed, total: subscriptions.length, errors });
  } catch (error) {
    return json(res, 500, { ok: false, error: error?.message || String(error) });
  }
};
