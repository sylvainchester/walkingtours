import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription } from "./push.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const marketingStart = document.getElementById("marketingStart");
const marketingEnd = document.getElementById("marketingEnd");
const marketingGuide = document.getElementById("marketingGuide");
const marketingTourType = document.getElementById("marketingTourType");
const marketingStatus = document.getElementById("marketingStatus");
const marketingEmpty = document.getElementById("marketingEmpty");
const marketingResults = document.getElementById("marketingResults");
const marketingPie = document.getElementById("marketingPie");
const marketingTotal = document.getElementById("marketingTotal");
const marketingLegend = document.getElementById("marketingLegend");
const marketingWeeks = document.getElementById("marketingWeeks");
const signOutBtn = document.getElementById("signOutBtn");
const avatarButton = document.getElementById("avatarButton");
const avatarDropdown = document.getElementById("avatarDropdown");

let session = null;
let sharedGuideIds = [];
let sharedGuideProfiles = new Map();

const PIE_COLORS = [
  "#2f855a",
  "#1f5aa6",
  "#d97706",
  "#b83280",
  "#6b46c1",
  "#8c5a2b",
  "#0f766e",
  "#be123c",
];

function setStatus(message) {
  if (marketingStatus) marketingStatus.textContent = message || "";
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function previousMonthRange() {
  const now = new Date();
  const end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - 1);
  const start = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
  return { start, end };
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

  const { data: profiles } = await supabase
    .from("guide_profiles")
    .select("id,first_name,last_name,email")
    .in("id", sharedGuideIds);
  sharedGuideProfiles = new Map((profiles || []).map((profile) => [profile.id, profile]));
}

function guideName(guideId) {
  const profile = sharedGuideProfiles.get(guideId);
  if (!profile) return "Unknown";
  return `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || profile.email || "Unknown";
}

function loadGuideFilter() {
  clearChildren(marketingGuide);
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All guides";
  marketingGuide.appendChild(allOption);

  sharedGuideIds
    .slice()
    .sort((a, b) => guideName(a).localeCompare(guideName(b)))
    .forEach((guideId) => {
      const option = document.createElement("option");
      option.value = guideId;
      option.textContent = guideName(guideId);
      marketingGuide.appendChild(option);
    });
}

async function loadTourTypes() {
  clearChildren(marketingTourType);

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All tours";
  marketingTourType.appendChild(allOption);

  const { data, error } = await supabase
    .from("tour_types")
    .select("name")
    .in("guide_id", sharedGuideIds)
    .order("name");

  if (error) {
    setStatus(`Tour type load error: ${error.message}`);
    return;
  }

  const names = Array.from(new Set((data || []).map((row) => String(row.name || "").trim()).filter(Boolean)));
  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    marketingTourType.appendChild(option);
  });
}

function renderPie(rows) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  marketingTotal.textContent = String(total);

  if (!total) {
    marketingPie.style.background = "#efe7c8";
    return;
  }

  let cursor = 0;
  const segments = rows.map((row, index) => {
    const color = PIE_COLORS[index % PIE_COLORS.length];
    const start = cursor;
    const sweep = (row.count / total) * 360;
    cursor += sweep;
    row.color = color;
    return `${color} ${start}deg ${cursor}deg`;
  });

  marketingPie.style.background = `conic-gradient(${segments.join(", ")})`;
}

function renderLegend(rows) {
  clearChildren(marketingLegend);

  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = "marketing-legend-item";

    const swatch = document.createElement("span");
    swatch.className = "marketing-swatch";
    swatch.style.backgroundColor = row.color;
    item.appendChild(swatch);

    const label = document.createElement("div");
    const pct = row.total ? Math.round((row.count / row.total) * 100) : 0;
    label.textContent = `${row.platform} · ${row.count} participants · ${pct}%`;
    item.appendChild(label);

    marketingLegend.appendChild(item);
  });
}

function isoWeekKey(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function weekRangeLabel(weekKey) {
  const match = String(weekKey || "").match(/^(\d{4})-W(\d{2})$/);
  if (!match) return weekKey;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const weekStart = new Date(jan4);
  weekStart.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + ((week - 1) * 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  const format = (date) => `${date.getUTCDate()} ${date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}`;
  return `${format(weekStart)} - ${format(weekEnd)}`;
}

function renderWeeklyBars(weeklyRows, platformColors) {
  clearChildren(marketingWeeks);

  if (!weeklyRows.length) return;

  const maxTotal = Math.max(...weeklyRows.map((row) => row.total), 1);

  weeklyRows.forEach((row) => {
    const wrap = document.createElement("div");
    wrap.className = "marketing-week-row";

    const label = document.createElement("div");
    label.className = "marketing-week-label";
    label.textContent = `${weekRangeLabel(row.week)} · ${row.total} participants`;
    wrap.appendChild(label);

    const bar = document.createElement("div");
    bar.className = "marketing-week-bar";
    bar.style.width = `${Math.max((row.total / maxTotal) * 100, 6)}%`;

    row.platforms.forEach((segment) => {
      const seg = document.createElement("div");
      seg.className = "marketing-week-segment";
      seg.style.backgroundColor = platformColors.get(segment.platform) || PIE_COLORS[0];
      seg.style.flex = String(segment.count);
      seg.title = `${segment.platform}: ${segment.count}`;
      bar.appendChild(seg);
    });

    wrap.appendChild(bar);
    marketingWeeks.appendChild(wrap);
  });
}

function invalidateMarketingResults() {
  marketingResults.hidden = true;
  marketingEmpty.hidden = false;
  marketingEmpty.textContent = "Refreshing chart...";
  marketingPie.style.background = "#efe7c8";
  marketingTotal.textContent = "0";
  clearChildren(marketingLegend);
  setStatus("");
  runMarketingReport();
}

async function runMarketingReport() {
  const start = marketingStart.value;
  const end = marketingEnd.value;
  const selectedGuide = String(marketingGuide.value || "").trim();
  const selectedType = String(marketingTourType.value || "").trim();

  if (!start || !end) {
    setStatus("Start date and end date are required.");
    return;
  }
  if (start > end) {
    setStatus("End date must be after start date.");
    return;
  }

  setStatus("Loading marketing data...");

  const { data, error } = await supabase
    .from("tours")
    .select("id,date,type,status,guide_id,participants(group_size,platform_name)")
    .in("guide_id", sharedGuideIds)
    .gte("date", start)
    .lte("date", end)
    .eq("status", "accepted")
    .order("date");

  if (error) {
    setStatus(`Marketing data error: ${error.message}`);
    return;
  }

  const filteredTours = (data || []).filter((tour) => !selectedType || tour.type === selectedType);
  const guideFilteredTours = filteredTours.filter((tour) => !selectedGuide || tour.guide_id === selectedGuide);
  const totals = new Map();
  const weekly = new Map();

  guideFilteredTours.forEach((tour) => {
    const week = isoWeekKey(tour.date);
    (tour.participants || []).forEach((participant) => {
      const platform = String(participant.platform_name || "Unknown").trim() || "Unknown";
      const groupSize = Number(participant.group_size || 0);
      if (groupSize <= 0) return;
      totals.set(platform, (totals.get(platform) || 0) + groupSize);

      if (!weekly.has(week)) weekly.set(week, new Map());
      const platformMap = weekly.get(week);
      platformMap.set(platform, (platformMap.get(platform) || 0) + groupSize);
    });
  });

  const rows = Array.from(totals.entries())
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count);

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  rows.forEach((row) => {
    row.total = total;
  });

  if (!rows.length) {
    marketingResults.hidden = true;
    marketingEmpty.hidden = false;
    marketingEmpty.textContent = "No participants found for these filters.";
    setStatus("");
    return;
  }

  marketingEmpty.hidden = true;
  marketingResults.hidden = false;
  renderPie(rows);
  renderLegend(rows);
  const platformColors = new Map(rows.map((row) => [row.platform, row.color]));
  const weeklyRows = Array.from(weekly.entries())
    .map(([week, platforms]) => {
      const platformRows = Array.from(platforms.entries())
        .map(([platform, count]) => ({ platform, count }))
        .sort((a, b) => b.count - a.count);
      return {
        week,
        total: platformRows.reduce((sum, item) => sum + item.count, 0),
        platforms: platformRows,
      };
    })
    .sort((a, b) => a.week.localeCompare(b.week));
  renderWeeklyBars(weeklyRows, platformColors);
  setStatus("");
}

async function init() {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (!session) {
    window.location.href = "sign-in.html";
    return;
  }

  const previousMonth = previousMonthRange();
  marketingStart.value = previousMonth.start;
  marketingEnd.value = previousMonth.end;

  await ensurePushSubscription(supabase, session);
  await refreshShareInviteIndicators();
  await loadSharedGuides();
  loadGuideFilter();
  await loadTourTypes();
  await runMarketingReport();
}

marketingStart?.addEventListener("change", invalidateMarketingResults);
marketingEnd?.addEventListener("change", invalidateMarketingResults);
marketingGuide?.addEventListener("change", invalidateMarketingResults);
marketingTourType?.addEventListener("change", invalidateMarketingResults);

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
