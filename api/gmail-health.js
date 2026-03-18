const { google } = require("googleapis");
const { createClient } = require("@supabase/supabase-js");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, x-cron-token");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  if (res.req?.method === "HEAD") {
    res.end();
    return;
  }
  res.end(JSON.stringify(body));
}

function maskClientId(value) {
  const raw = String(value || "");
  if (!raw) return null;
  if (raw.length <= 12) return raw;
  return `${raw.slice(0, 8)}...${raw.slice(-4)}`;
}

function extractErrorDetails(error) {
  const code = error?.code || error?.response?.status || null;
  const message = error?.response?.data?.error_description
    || error?.response?.data?.error
    || error?.message
    || String(error);
  return { code, message };
}

async function verifyUserId(req) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const authHeader = req.headers.authorization || "";
  if (!supabaseUrl || !anonKey || !authHeader.startsWith("Bearer ")) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: authHeader,
    },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id || null;
}

async function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    throw new Error("Missing Supabase server env vars");
  }
  return createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false },
  });
}

async function writeHealthLog(supabase, payload) {
  try {
    await supabase.from("gmail_health_logs").insert(payload);
  } catch (_error) {
    // Do not fail health endpoint if logging table is missing or insert fails.
  }
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });
  if (!["GET", "HEAD"].includes(req.method)) return json(res, 405, { ok: false, error: "Method not allowed" });

  const expectedToken = process.env.GMAIL_HEALTH_TOKEN || process.env.POLL_BOOKINGS_TOKEN;
  const providedToken = String(req.query?.token || req.headers["x-cron-token"] || "").trim();

  try {
    const callerId = await verifyUserId(req);
    const tokenAuthorized = Boolean(expectedToken) && providedToken === expectedToken;
    if (!callerId && !tokenAuthorized) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }

    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
      return json(res, 500, { ok: false, error: "Missing Gmail OAuth env vars" });
    }

    const supabase = await getSupabaseAdmin();
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const [profileRes, messagesRes] = await Promise.all([
      gmail.users.getProfile({ userId: "me" }),
      gmail.users.messages.list({
        userId: "me",
        q: "in:anywhere is:unread newer_than:30d",
        maxResults: 1,
      }),
    ]);

    const payload = {
      ok: true,
      checked_at: new Date().toISOString(),
      checked_by: callerId,
      mode: callerId ? "authenticated" : "token",
      gmail_address: profileRes.data.emailAddress || null,
      gmail_unread_count: Number(messagesRes.data.resultSizeEstimate || 0),
      oauth_client_id_masked: maskClientId(clientId),
      error_code: null,
      error_message: null,
    };
    await writeHealthLog(supabase, payload);

    return json(res, 200, {
      ok: true,
      gmail_address: payload.gmail_address,
      unread_count: payload.gmail_unread_count,
      checked_at: payload.checked_at,
      oauth_client_id_masked: payload.oauth_client_id_masked,
      mode: payload.mode,
    });
  } catch (error) {
    const { code, message } = extractErrorDetails(error);
    let supabase = null;
    try {
      supabase = await getSupabaseAdmin();
      await writeHealthLog(supabase, {
        ok: false,
        checked_at: new Date().toISOString(),
        checked_by: await verifyUserId(req),
        mode: (req.headers.authorization || "").startsWith("Bearer ") ? "authenticated" : "token",
        gmail_address: null,
        gmail_unread_count: null,
        oauth_client_id_masked: maskClientId(process.env.GMAIL_CLIENT_ID),
        error_code: code ? String(code) : null,
        error_message: message,
      });
    } catch (_inner) {
      // Ignore logging failure.
    }

    return json(res, 500, {
      ok: false,
      error: message,
      error_code: code ? String(code) : null,
      checked_at: new Date().toISOString(),
      oauth_client_id_masked: maskClientId(process.env.GMAIL_CLIENT_ID),
    });
  }
};
