const { createClient } = require("@supabase/supabase-js");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.end(JSON.stringify(body));
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

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const callerId = await verifyUserId(req);
    if (!callerId) return json(res, 401, { ok: false, error: "Unauthorized" });

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRole) {
      return json(res, 500, { ok: false, error: "Missing server env vars" });
    }

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false },
    });

    const invoiceId = String(req.body?.invoice_id || "").trim();
    if (!invoiceId) {
      return json(res, 400, { ok: false, error: "Missing invoice id" });
    }

    const { data: invoice, error: fetchError } = await supabase
      .from("invoices")
      .select("id,file_path,created_by,guide_ids")
      .eq("id", invoiceId)
      .single();
    if (fetchError || !invoice) {
      return json(res, 404, { ok: false, error: "Invoice not found" });
    }

    const allowed = invoice.created_by === callerId || (invoice.guide_ids || []).includes(callerId);
    if (!allowed) {
      return json(res, 403, { ok: false, error: "Forbidden" });
    }

    const { error: storageError } = await supabase.storage
      .from("invoices")
      .remove([invoice.file_path]);
    if (storageError) {
      return json(res, 500, { ok: false, error: `Storage delete failed: ${storageError.message}` });
    }

    const { error: deleteError } = await supabase
      .from("invoices")
      .delete()
      .eq("id", invoiceId);
    if (deleteError) {
      return json(res, 500, { ok: false, error: `Invoice delete failed: ${deleteError.message}` });
    }

    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, 500, { ok: false, error: error?.message || String(error) });
  }
};
