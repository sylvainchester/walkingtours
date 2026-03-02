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

function buildSharedGuideIds(rows, callerId) {
  const ids = new Set([callerId]);
  (rows || []).forEach((row) => {
    if (row.guide_id) ids.add(row.guide_id);
    if (row.shared_with_id) ids.add(row.shared_with_id);
  });
  return Array.from(ids);
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

    const draftId = String(req.body?.draft_id || "").trim();
    const action = String(req.body?.action || "").trim();
    if (!draftId || !["confirm", "reject"].includes(action)) {
      return json(res, 400, { ok: false, error: "Missing draft id or invalid action" });
    }

    const { data: shareRows, error: shareError } = await supabase
      .from("guide_shares")
      .select("guide_id,shared_with_id")
      .or(`guide_id.eq.${callerId},shared_with_id.eq.${callerId}`);
    if (shareError) return json(res, 500, { ok: false, error: shareError.message });
    const guideIds = buildSharedGuideIds(shareRows, callerId);

    const { data: draft, error: draftError } = await supabase
      .from("incoming_booking_emails")
      .select("id,matched_tour_id,matched_platform_name,imported_participants,status")
      .eq("id", draftId)
      .single();
    if (draftError || !draft) return json(res, 404, { ok: false, error: "Draft not found" });
    if (!["pending_review", "error", "ignored", "received"].includes(draft.status)) {
      return json(res, 400, { ok: false, error: "Draft already reviewed" });
    }
    if (!draft.matched_tour_id) {
      return json(res, 400, { ok: false, error: "No matched tour for this draft" });
    }

    const { data: tour, error: tourError } = await supabase
      .from("tours")
      .select("id,guide_id")
      .eq("id", draft.matched_tour_id)
      .single();
    if (tourError || !tour) return json(res, 404, { ok: false, error: "Matched tour not found" });
    if (!guideIds.includes(tour.guide_id)) {
      return json(res, 403, { ok: false, error: "Forbidden" });
    }

    if (action === "reject") {
      const { error } = await supabase
        .from("incoming_booking_emails")
        .update({
          status: "rejected",
          reviewed_by: callerId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", draft.id);
      if (error) return json(res, 500, { ok: false, error: error.message });
      return json(res, 200, { ok: true });
    }

    const participants = Array.isArray(draft.imported_participants) ? draft.imported_participants : [];
    if (!participants.length) {
      return json(res, 400, { ok: false, error: "No proposed participants to import" });
    }

    const rows = participants.map((participant) => ({
      tour_id: draft.matched_tour_id,
      name: String(participant.name || "").trim(),
      group_size: Number(participant.group_size || 0),
      platform_name: String(participant.platform_name || draft.matched_platform_name || "").trim() || null,
    })).filter((participant) => participant.name && participant.group_size > 0);

    if (!rows.length) {
      return json(res, 400, { ok: false, error: "No valid participants to import" });
    }

    const { error: insertError } = await supabase.from("participants").insert(rows);
    if (insertError) return json(res, 500, { ok: false, error: insertError.message });

    const { error: updateError } = await supabase
      .from("incoming_booking_emails")
      .update({
        status: "confirmed",
        reviewed_by: callerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", draft.id);
    if (updateError) return json(res, 500, { ok: false, error: updateError.message });

    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, 500, { ok: false, error: error?.message || String(error) });
  }
};
