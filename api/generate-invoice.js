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

function computeInvoicePersons(participants) {
  if (!participants || participants.length === 0) return 0;
  return participants.reduce((sum, p) => sum + Number(p.group_size || 0), 0);
}

function getParticipantEffectiveAmount(participant, fallbackAmount) {
  const direct = Number(participant?.paid_amount);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const fallback = Number(fallbackAmount);
  const groupSize = Math.max(1, Number(participant?.group_size || 1));
  return Number.isFinite(fallback) && fallback >= 0 ? Number((fallback * groupSize).toFixed(2)) : 0;
}

function computeParticipantsGross(participants, fallbackAmount) {
  return (participants || [])
    .reduce(
      (sum, participant) => sum + getParticipantEffectiveAmount(participant, fallbackAmount),
      0
    );
}

function getUnitPriceLabel(participants, fallbackAmount) {
  const amounts = Array.from(new Set(
    (participants || [])
      .map((participant) => {
        const groupSize = Math.max(1, Number(participant.group_size || 1));
        const totalAmount = getParticipantEffectiveAmount(participant, fallbackAmount);
        return Number((totalAmount / groupSize).toFixed(2));
      })
  ));
  if (amounts.length === 1) return money(amounts[0]);
  if (amounts.length > 1) return "mixed rates";
  return money(fallbackAmount || 0);
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
    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
    });
    return buffer;
  } finally {
    await browser.close();
  }
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    return json(res, 200, { ok: true });
  }
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

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

    const tourId = req.body?.tour_id;
    if (!tourId) return json(res, 400, { ok: false, error: "Missing tour_id" });

    const { data: tour, error: tourError } = await supabase
      .from("tours")
      .select("id,date,type,platform,guide_id,created_by,status,price_per_person,participants(id,name,group_size,attendance_status,paid_amount,booked_at)")
      .eq("id", tourId)
      .maybeSingle();
    if (tourError || !tour) return json(res, 404, { ok: false, error: "Tour not found" });

    if (!(tour.guide_id === callerId || tour.created_by === callerId)) {
      return json(res, 403, { ok: false, error: "Forbidden" });
    }
    if (tour.status !== "accepted") {
      return json(res, 400, { ok: false, error: "Tour must be accepted" });
    }

    const [profileRes, typeRes] = await Promise.all([
      supabase
        .from("guide_profiles")
        .select("first_name,last_name,email,sort_code,account_number,account_name")
        .eq("id", tour.guide_id)
        .maybeSingle(),
      supabase
        .from("tour_types")
        .select("payment_type,ticket_price,fee_per_participant,platforms")
        .eq("guide_id", tour.guide_id)
        .eq("name", tour.type)
        .maybeSingle(),
    ]);

    const profile = profileRes.data || {};
    const tourType = typeRes.data || {};
    if (tourType.payment_type === "free") {
      return json(res, 400, { ok: false, error: "Free tours do not generate invoices" });
    }
    const platforms = Array.isArray(tourType.platforms) ? tourType.platforms : [];
    const selectedPlatform = platforms.find(
      (platform) => String(platform?.name || "").trim().toLowerCase()
        === String(tour?.platform?.name || "").trim().toLowerCase()
    ) || tour.platform || platforms[0] || null;
    if (!selectedPlatform) {
      return json(res, 400, { ok: false, error: "No platform configured for this tour" });
    }
    if (selectedPlatform.requires_invoice === false) {
      return json(res, 400, { ok: false, error: "This platform does not require an invoice" });
    }

    const personsTotal = computeInvoicePersons(tour.participants || []);
    const fallbackUnitPrice = Number(
      tour.price_per_person ?? selectedPlatform.default_price ?? (
        tourType.payment_type === "free"
          ? (tourType.fee_per_participant ?? 0)
          : (tourType.ticket_price ?? 0)
      )
    );
    const commissionPct = Number(selectedPlatform.commission_percent ?? 0);
    const gross = computeParticipantsGross(tour.participants || [], fallbackUnitPrice);
    const commission = (gross * commissionPct) / 100;
    const total = gross - commission;

    const invoiceNo = `INV-${tour.date.replaceAll("-", "")}-${tour.id.slice(0, 8).toUpperCase()}`;
    const bookingRef = tour.id.slice(0, 8).toUpperCase();
    const prettyDate = new Date(`${tour.date}T00:00:00`).toLocaleDateString("en-GB", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    const templatePath = path.join(process.cwd(), "invoice.html");
    const template = fs.readFileSync(templatePath, "utf8");
    let iconSrc = "";
    const iconPath = path.join(process.cwd(), "icon.png");
    if (fs.existsSync(iconPath)) {
      const iconBase64 = fs.readFileSync(iconPath).toString("base64");
      iconSrc = `data:image/png;base64,${iconBase64}`;
    }
    const html = replaceTokens(template, {
      invoiceNo,
      guideFirstName: profile.first_name || "",
      guideLastName: profile.last_name || "",
      clientName: selectedPlatform.name || "Invoice client",
      prettyDate,
      bookingRef,
      tourLabel: tour.type || "Tour",
      personsTotal,
      pricePerPerson: getUnitPriceLabel(tour.participants || [], fallbackUnitPrice),
      gross: money(gross),
      CommisionPct: commissionPct.toFixed(2),
      vicCommission: money(commission),
      total: money(total),
      bankPayeeName: profile.account_name || "",
      bankSortCode: profile.sort_code || "",
      bankAccountNumber: profile.account_number || "",
      bankEmail: profile.email || "",
      iconSrc,
    });

    const pdfBuffer = await renderPdfFromHtml(html);
    const filePath = `${tour.guide_id}/${tour.date}/${tour.id}/${invoiceNo}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("invoices")
      .upload(filePath, pdfBuffer, { contentType: "application/pdf", upsert: true });
    if (uploadError) {
      return json(res, 500, { ok: false, error: `Upload failed: ${uploadError.message}` });
    }

    return json(res, 200, { ok: true, filePath, invoiceNo });
  } catch (error) {
    return json(res, 500, { ok: false, error: error?.message || String(error) });
  }
};
