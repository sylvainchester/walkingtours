import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription } from "./push.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const invoicePlatform = document.getElementById("invoicePlatform");
const invoiceStart = document.getElementById("invoiceStart");
const invoiceEnd = document.getElementById("invoiceEnd");
const createInvoiceBtn = document.getElementById("createInvoiceBtn");
const invoiceStatus = document.getElementById("invoiceStatus");
const invoiceList = document.getElementById("invoiceList");
const signOutBtn = document.getElementById("signOutBtn");
const avatarButton = document.getElementById("avatarButton");
const avatarDropdown = document.getElementById("avatarDropdown");

let session = null;
let sharedGuideIds = [];

function setStatus(message) {
  if (invoiceStatus) invoiceStatus.textContent = message || "";
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

async function refreshShareInviteIndicators() {
  if (!session) return;
  const { count, error } = await supabase
    .from("guide_share_invites")
    .select("id", { head: true, count: "exact" })
    .eq("to_guide_id", session.user.id)
    .eq("status", "pending");
  if (error) return;
  const hasPending = Number(count || 0) > 0;
  avatarButton?.classList.toggle("has-pending-dot", hasPending);
  avatarDropdown?.querySelector('a[href="share.html"]')
    ?.classList.toggle("has-pending-dot", hasPending);
}

async function loadSharedGuides() {
  const ids = new Set([session.user.id]);
  const { data } = await supabase
    .from("guide_shares")
    .select("guide_id,shared_with_id")
    .or(`guide_id.eq.${session.user.id},shared_with_id.eq.${session.user.id}`);
  (data || []).forEach((row) => {
    if (row.guide_id) ids.add(row.guide_id);
    if (row.shared_with_id) ids.add(row.shared_with_id);
  });
  sharedGuideIds = Array.from(ids);
}

async function loadPlatforms() {
  clearChildren(invoicePlatform);
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a platform";
  invoicePlatform.appendChild(placeholder);

  const { data, error } = await supabase
    .from("tour_types")
    .select("platforms,payment_type")
    .in("guide_id", sharedGuideIds);

  if (error) {
    setStatus(`Platform load error: ${error.message}`);
    return;
  }

  const names = new Set();
  (data || []).forEach((type) => {
    if (type.payment_type === "free") return;
    (Array.isArray(type.platforms) ? type.platforms : []).forEach((platform) => {
      if (platform?.requires_invoice === false) return;
      const name = String(platform?.name || "").trim();
      if (name) names.add(name);
    });
  });

  Array.from(names).sort().forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    invoicePlatform.appendChild(option);
  });
}

async function loadInvoices() {
  clearChildren(invoiceList);
  const { data, error } = await supabase
    .from("invoices")
    .select("id,platform_name,period_start,period_end,invoice_no,file_path,total_participants,total_amount,created_at")
    .order("created_at", { ascending: false });
  if (error) {
    setStatus(`Invoice load error: ${error.message}`);
    return;
  }

  if (!data || data.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "No invoices yet.";
    invoiceList.appendChild(empty);
    return;
  }

  data.forEach((invoice) => {
    const row = document.createElement("div");
    row.className = "participant";

    const text = document.createElement("div");
    text.textContent = `${invoice.platform_name} · ${invoice.period_start} to ${invoice.period_end} · ${invoice.total_participants} participants`;
    row.appendChild(text);

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "ghost";
    openBtn.textContent = "📎";
    openBtn.title = "Open PDF";
    openBtn.addEventListener("click", async () => {
      const { data: urlData, error: urlError } = await supabase.storage
        .from("invoices")
        .createSignedUrl(invoice.file_path, 60 * 30);
      if (urlError || !urlData?.signedUrl) {
        setStatus(`Invoice link error: ${urlError?.message || "Unknown error"}`);
        return;
      }
      window.open(urlData.signedUrl, "_blank", "noopener,noreferrer");
    });
    row.appendChild(openBtn);
    invoiceList.appendChild(row);
  });
}

async function createInvoice() {
  const platformName = String(invoicePlatform.value || "").trim();
  const periodStart = invoiceStart.value;
  const periodEnd = invoiceEnd.value;
  if (!platformName || !periodStart || !periodEnd) {
    setStatus("Platform and period are required.");
    return;
  }

  const isLocalHost = ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
  const apiUrl = isLocalHost
    ? "https://walkingtours.vercel.app/api/create-invoice"
    : "/api/create-invoice";
  const { data: authData } = await supabase.auth.getSession();
  const accessToken = authData?.session?.access_token;
  if (!accessToken) {
    setStatus("Auth session missing.");
    return;
  }

  setStatus("Creating invoice...");
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      platform_name: platformName,
      period_start: periodStart,
      period_end: periodEnd,
    }),
  });
  const contentType = response.headers.get("content-type") || "";
  const result = contentType.includes("application/json")
    ? await response.json()
    : { ok: false, error: await response.text() };
  if (!response.ok || !result?.ok) {
    setStatus(result?.error || "Invoice creation failed.");
    return;
  }

  setStatus("Invoice created.");
  await loadInvoices();
}

async function init() {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (!session) {
    window.location.href = "sign-in.html";
    return;
  }

  await ensurePushSubscription(supabase, session);
  await refreshShareInviteIndicators();
  await loadSharedGuides();
  await loadPlatforms();
  await loadInvoices();
}

createInvoiceBtn?.addEventListener("click", createInvoice);

if (signOutBtn) {
  signOutBtn.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "sign-in.html";
  });
}

if (avatarButton && avatarDropdown) {
  avatarButton.addEventListener("click", () => {
    const isOpen = avatarDropdown.classList.contains("open");
    avatarDropdown.classList.toggle("open", !isOpen);
    avatarButton.setAttribute("aria-expanded", String(!isOpen));
  });
  document.addEventListener("click", (event) => {
    if (avatarDropdown.contains(event.target) || avatarButton.contains(event.target)) return;
    avatarDropdown.classList.remove("open");
    avatarButton.setAttribute("aria-expanded", "false");
  });
}

init();
