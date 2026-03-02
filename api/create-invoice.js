const fs = require("fs");
const path = require("path");
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");
const { createClient } = require("@supabase/supabase-js");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.end(JSON.stringify(body));
}

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function replaceTokens(template, values) {
  return template.replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (_m, key) => String(values[key] ?? ""));
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

async function renderPdfFromHtml(html) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
    });
  } finally {
    await browser.close();
  }
}

function buildSharedGuideIds(rows, callerId) {
  const ids = new Set([callerId]);
  (rows || []).forEach((row) => {
    if (row.guide_id) ids.add(row.guide_id);
    if (row.shared_with_id) ids.add(row.shared_with_id);
  });
  return Array.from(ids);
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveTourTypeForInvoice(tour, types, platformName) {
  const normalizedTypeName = normalizeName(tour?.type);
  const normalizedPlatformName = normalizeName(platformName || tour?.platform?.name);
  if (!normalizedTypeName) return null;

  const exact = (types || []).find(
    (type) => type.guide_id === tour.guide_id && normalizeName(type.name) === normalizedTypeName
  );
  if (exact) return exact;

  const sameName = (types || []).filter((type) => normalizeName(type.name) === normalizedTypeName);
  if (!sameName.length) return null;

  const withPlatform = sameName.find((type) =>
    (Array.isArray(type.platforms) ? type.platforms : []).some(
      (platform) => normalizeName(platform?.name) === normalizedPlatformName
    )
  );
  return withPlatform || sameName[0];
}

function resolveInvoicePlatform(tour, type, platformName) {
  const normalizedPlatformName = normalizeName(platformName);
  const tourPlatform = tour?.platform;
  if (normalizeName(tourPlatform?.name) === normalizedPlatformName) {
    return tourPlatform;
  }

  return (Array.isArray(type?.platforms) ? type.platforms : []).find(
    (platform) => normalizeName(platform?.name) === normalizedPlatformName
  ) || null;
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

    const platformName = String(req.body?.platform_name || "").trim();
    const periodStart = String(req.body?.period_start || "").trim();
    const periodEnd = String(req.body?.period_end || "").trim();
    if (!platformName || !periodStart || !periodEnd) {
      return json(res, 400, { ok: false, error: "Missing platform or period" });
    }
    if (periodStart > periodEnd) {
      return json(res, 400, { ok: false, error: "Start date must be before end date" });
    }

    const { data: shareRows, error: shareError } = await supabase
      .from("guide_shares")
      .select("guide_id,shared_with_id")
      .or(`guide_id.eq.${callerId},shared_with_id.eq.${callerId}`);
    if (shareError) {
      return json(res, 500, { ok: false, error: shareError.message });
    }
    const guideIds = buildSharedGuideIds(shareRows, callerId);

    const [toursRes, typesRes, profilesRes] = await Promise.all([
      supabase
        .from("tours")
        .select("id,date,start_time,end_time,type,guide_id,participants_locked,participants(platform_name,group_size,attendance_status)")
        .in("guide_id", guideIds)
        .eq("participants_locked", true)
        .gte("date", periodStart)
        .lte("date", periodEnd)
        .order("date")
        .order("start_time"),
      supabase
        .from("tour_types")
        .select("guide_id,name,payment_type,ticket_price,platforms")
        .in("guide_id", guideIds),
      supabase
        .from("guide_profiles")
        .select("id,first_name,last_name")
        .in("id", guideIds),
    ]);

    if (toursRes.error) return json(res, 500, { ok: false, error: toursRes.error.message });
    if (typesRes.error) return json(res, 500, { ok: false, error: typesRes.error.message });
    if (profilesRes.error) return json(res, 500, { ok: false, error: profilesRes.error.message });

    const profileMap = new Map((profilesRes.data || []).map((profile) => [profile.id, profile]));

    const rows = [];
    let totalParticipants = 0;
    let totalAmount = 0;

    for (const tour of toursRes.data || []) {
      const type = resolveTourTypeForInvoice(tour, typesRes.data || [], platformName);
      if (!type || type.payment_type === "free") continue;
      const matchedPlatform = resolveInvoicePlatform(tour, type, platformName);
      if (!matchedPlatform || matchedPlatform.requires_invoice === false) continue;

      const arrivedParticipants = (tour.participants || []).filter(
        (participant) =>
          participant.attendance_status === "arrived"
          && normalizeName(participant.platform_name) === normalizeName(platformName)
      );
      const participantCount = arrivedParticipants.reduce(
        (sum, participant) => sum + Number(participant.group_size || 0),
        0
      );
      if (participantCount <= 0) continue;

      const unitPrice = Number(type.ticket_price || 0);
      const gross = participantCount * unitPrice;
      const commissionPct = Number(matchedPlatform.commission_percent || 0);
      const commission = (gross * commissionPct) / 100;
      const net = gross - commission;
      const guideProfile = profileMap.get(tour.guide_id);
      const guideName = guideProfile
        ? `${guideProfile.first_name || ""} ${guideProfile.last_name || ""}`.trim()
        : "Unknown guide";

      rows.push({
        date: tour.date,
        time: `${String(tour.start_time || "").slice(0, 5)}-${String(tour.end_time || "").slice(0, 5)}`,
        guide: guideName,
        tour: tour.type,
        participantCount,
        net,
      });
      totalParticipants += participantCount;
      totalAmount += net;
    }

    if (!rows.length) {
      return json(res, 400, { ok: false, error: "No locked tours found for this platform and period" });
    }

    const invoiceNo = `INV-${platformName.replace(/[^A-Za-z0-9]+/g, "").toUpperCase().slice(0, 10)}-${periodStart.replaceAll("-", "")}-${periodEnd.replaceAll("-", "")}`;
    const generatedAt = new Date().toLocaleString("en-GB");
    const rowsHtml = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.date)}</td>
        <td>${escapeHtml(row.time)}</td>
        <td>${escapeHtml(row.guide)}</td>
        <td>${escapeHtml(row.tour)}</td>
        <td class="right">${escapeHtml(row.participantCount)}</td>
        <td class="right">${escapeHtml(money(row.net))}</td>
      </tr>
    `).join("");

    const templatePath = path.join(process.cwd(), "invoice-summary.html");
    const template = fs.readFileSync(templatePath, "utf8");
    const html = replaceTokens(template, {
      invoiceNo,
      platformName: escapeHtml(platformName),
      periodStart: escapeHtml(periodStart),
      periodEnd: escapeHtml(periodEnd),
      generatedAt: escapeHtml(generatedAt),
      rowsHtml,
      totalParticipants: totalParticipants,
      totalAmount: money(totalAmount),
    });

    const pdfBuffer = await renderPdfFromHtml(html);
    const filePath = `shared/${callerId}/${Date.now()}-${invoiceNo}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("invoices")
      .upload(filePath, pdfBuffer, { contentType: "application/pdf", upsert: true });
    if (uploadError) {
      return json(res, 500, { ok: false, error: `Upload failed: ${uploadError.message}` });
    }

    const { error: insertError } = await supabase.from("invoices").insert({
      created_by: callerId,
      guide_ids: guideIds,
      platform_name: platformName,
      period_start: periodStart,
      period_end: periodEnd,
      invoice_no: invoiceNo,
      file_path: filePath,
      total_participants: totalParticipants,
      total_amount: Number(totalAmount.toFixed(2)),
    });
    if (insertError) {
      return json(res, 500, { ok: false, error: `Invoice save failed: ${insertError.message}` });
    }

    return json(res, 200, { ok: true, invoiceNo, filePath });
  } catch (error) {
    return json(res, 500, { ok: false, error: error?.message || String(error) });
  }
};
