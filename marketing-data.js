import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription } from "./push.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const marketingStart = document.getElementById("marketingStart");
const marketingEnd = document.getElementById("marketingEnd");
const marketingGuide = document.getElementById("marketingGuide");
const marketingTourType = document.getElementById("marketingTourType");
const marketingPlatform = document.getElementById("marketingPlatform");
const marketingStatus = document.getElementById("marketingStatus");
const marketingEmpty = document.getElementById("marketingEmpty");
const marketingResults = document.getElementById("marketingResults");
const marketingOverview = document.getElementById("marketingOverview");
const marketingPie = document.getElementById("marketingPie");
const marketingPieLabels = document.getElementById("marketingPieLabels");
const marketingTotal = document.getElementById("marketingTotal");
const marketingLegend = document.getElementById("marketingLegend");
const marketingWeeks = document.getElementById("marketingWeeks");
const marketingPlatformDetail = document.getElementById("marketingPlatformDetail");
const marketingPlatformSummary = document.getElementById("marketingPlatformSummary");
const marketingPlatformTours = document.getElementById("marketingPlatformTours");
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

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function previousMonthRange() {
  const now = new Date();
  const end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - 1);
  const start = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
  return { start, end };
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function guideName(guideId) {
  const profile = sharedGuideProfiles.get(guideId);
  if (!profile) return "Unknown";
  return `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || profile.email || "Unknown";
}

function getParticipantEffectiveAmount(participant, fallbackAmount) {
  const direct = Number(participant?.paid_amount);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const fallback = Number(fallbackAmount);
  const groupSize = Math.max(1, Number(participant?.group_size || 1));
  return Number.isFinite(fallback) && fallback >= 0 ? Number((fallback * groupSize).toFixed(2)) : 0;
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

async function loadPlatformFilter() {
  clearChildren(marketingPlatform);

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All platforms";
  marketingPlatform.appendChild(allOption);

  const { data, error } = await supabase
    .from("tours")
    .select("platform,participants(platform_name)")
    .in("guide_id", sharedGuideIds);

  if (error) {
    setStatus(`Platform load error: ${error.message}`);
    return;
  }

  const names = new Set();
  (data || []).forEach((tour) => {
    const platformName = String(tour?.platform?.name || "").trim();
    if (platformName) names.add(platformName);
    (tour.participants || []).forEach((participant) => {
      const participantPlatform = String(participant?.platform_name || "").trim();
      if (participantPlatform) names.add(participantPlatform);
    });
  });

  Array.from(names)
    .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }))
    .forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      marketingPlatform.appendChild(option);
    });
}

function renderPie(rows) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  marketingTotal.textContent = String(total);
  clearChildren(marketingPieLabels);

  if (!total) {
    marketingPie.style.background = "#efe7c8";
    return;
  }

  let cursor = 0;
  const segments = rows.map((row, index) => {
    const color = PIE_COLORS[index % PIE_COLORS.length];
    const start = cursor;
    const sweep = (row.count / total) * 360;
    const mid = start + (sweep / 2);
    cursor += sweep;
    row.color = color;
    row.percent = Math.round((row.count / total) * 100);
    row.midAngle = mid;
    return `${color} ${start}deg ${cursor}deg`;
  });

  marketingPie.style.background = `conic-gradient(${segments.join(", ")})`;

  rows.forEach((row) => {
    if (row.percent < 5) return;
    const label = document.createElement("div");
    label.className = "marketing-pie-slice-label";
    label.textContent = `${row.percent}%`;
    const radians = ((row.midAngle - 90) * Math.PI) / 180;
    const radius = 38;
    const x = 50 + (Math.cos(radians) * radius);
    const y = 50 + (Math.sin(radians) * radius);
    label.style.left = `${x}%`;
    label.style.top = `${y}%`;
    marketingPieLabels.appendChild(label);
  });
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
    label.textContent = row.platform;
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

function renderPlatformDetail(tours, platformName) {
  clearChildren(marketingPlatformSummary);
  clearChildren(marketingPlatformTours);

  const totalRevenue = tours.reduce((sum, tour) => {
    return sum + tour.participants.reduce((tourSum, participant) => {
      return tourSum + participant.paidAmount;
    }, 0);
  }, 0);

  const summaryCard = document.createElement("div");
  summaryCard.className = "marketing-platform-summary-card";
  summaryCard.textContent = `${platformName} · total revenue ${money(totalRevenue)}`;
  marketingPlatformSummary.appendChild(summaryCard);

  tours.forEach((tour) => {
    const card = document.createElement("div");
    card.className = "marketing-tour-card";

    const header = document.createElement("div");
    header.className = "marketing-tour-header";
    const participantTotal = tour.participants.reduce((sum, participant) => sum + participant.groupSize, 0);
    const revenue = tour.participants.reduce((sum, participant) => sum + participant.paidAmount, 0);
    header.textContent = `${tour.date} · ${(tour.startTime || "").slice(0, 5)} · ${tour.type} · ${guideName(tour.guideId)} · ${participantTotal} people · ${money(revenue)}`;
    card.appendChild(header);

    const list = document.createElement("div");
    list.className = "marketing-tour-participants";

    tour.participants.forEach((participant) => {
      const row = document.createElement("div");
      row.className = `marketing-tour-participant ${participant.creationSource === "email_import" ? "is-import" : "is-manual"}`;
      const sourceLabel = participant.creationSource === "email_import" ? "Imported" : "Created";
      const sourceDate = participant.createdAt ? `${sourceLabel} on ${formatDateTime(participant.createdAt)}` : sourceLabel;

      const badge = document.createElement("span");
      badge.className = `marketing-source-badge ${participant.creationSource === "email_import" ? "is-import" : "is-manual"}`;
      badge.textContent = participant.creationSource === "email_import" ? "Email" : "Manual";
      row.appendChild(badge);

      const text = document.createElement("span");
      text.textContent = `${participant.name} · ${money(participant.paidAmount)} · ${participant.groupSize} person${participant.groupSize === 1 ? "" : "s"} · ${sourceDate}`;
      row.appendChild(text);

      list.appendChild(row);
    });

    card.appendChild(list);
    marketingPlatformTours.appendChild(card);
  });
}

function invalidateMarketingResults() {
  marketingResults.hidden = true;
  marketingEmpty.hidden = false;
  marketingEmpty.textContent = "Refreshing chart...";
  marketingPie.style.background = "#efe7c8";
  marketingTotal.textContent = "0";
  clearChildren(marketingLegend);
  clearChildren(marketingWeeks);
  clearChildren(marketingPlatformSummary);
  clearChildren(marketingPlatformTours);
  setStatus("");
  runMarketingReport();
}

async function runMarketingReport() {
  const start = marketingStart.value;
  const end = marketingEnd.value;
  const selectedGuide = String(marketingGuide.value || "").trim();
  const selectedType = String(marketingTourType.value || "").trim();
  const selectedPlatform = String(marketingPlatform.value || "").trim();

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
    .select("id,date,start_time,type,status,guide_id,price_per_person,participants(name,group_size,platform_name,paid_amount,creation_source,created_at)")
    .in("guide_id", sharedGuideIds)
    .gte("date", start)
    .lte("date", end)
    .eq("status", "accepted")
    .order("date")
    .order("start_time");

  if (error) {
    setStatus(`Marketing data error: ${error.message}`);
    return;
  }

  const guideFilteredTours = (data || [])
    .filter((tour) => !selectedType || tour.type === selectedType)
    .filter((tour) => !selectedGuide || tour.guide_id === selectedGuide);

  if (!selectedPlatform) {
    const totals = new Map();
    const weekly = new Map();

    guideFilteredTours.forEach((tour) => {
      const week = isoWeekKey(tour.date);
      (tour.participants || []).forEach((participant) => {
        const platformName = String(participant.platform_name || "Unknown").trim() || "Unknown";
        const groupSize = Number(participant.group_size || 0);
        if (groupSize <= 0) return;
        totals.set(platformName, (totals.get(platformName) || 0) + groupSize);

        if (!weekly.has(week)) weekly.set(week, new Map());
        const platformMap = weekly.get(week);
        platformMap.set(platformName, (platformMap.get(platformName) || 0) + groupSize);
      });
    });

    const rows = Array.from(totals.entries())
      .map(([platformName, count]) => ({ platform: platformName, count }))
      .sort((left, right) => right.count - left.count);

    if (!rows.length) {
      marketingResults.hidden = true;
      marketingEmpty.hidden = false;
      marketingEmpty.textContent = "No participants found for these filters.";
      setStatus("");
      return;
    }

    marketingEmpty.hidden = true;
    marketingResults.hidden = false;
    marketingOverview.hidden = false;
    marketingPlatformDetail.hidden = true;

    renderPie(rows);
    renderLegend(rows);
    const platformColors = new Map(rows.map((row) => [row.platform, row.color]));
    const weeklyRows = Array.from(weekly.entries())
      .map(([week, platforms]) => {
        const platformRows = Array.from(platforms.entries())
          .map(([platformName, count]) => ({ platform: platformName, count }))
          .sort((left, right) => right.count - left.count);
        return {
          week,
          total: platformRows.reduce((sum, item) => sum + item.count, 0),
          platforms: platformRows,
        };
      })
      .sort((left, right) => left.week.localeCompare(right.week));
    renderWeeklyBars(weeklyRows, platformColors);
    setStatus("");
    return;
  }

  const matchingTours = guideFilteredTours
    .map((tour) => {
      const participants = (tour.participants || [])
        .filter((participant) => normalizeName(participant.platform_name) === normalizeName(selectedPlatform))
        .map((participant) => ({
          name: String(participant.name || "").trim() || "Unknown",
          groupSize: Number(participant.group_size || 0),
          paidAmount: getParticipantEffectiveAmount(participant, tour.price_per_person),
          creationSource: String(participant.creation_source || "manual"),
          createdAt: participant.created_at || null,
        }))
        .filter((participant) => participant.groupSize > 0);

      return {
        id: tour.id,
        date: tour.date,
        startTime: tour.start_time,
        type: tour.type,
        guideId: tour.guide_id,
        participants,
      };
    })
    .filter((tour) => tour.participants.length > 0)
    .sort((left, right) => {
      const dateCompare = left.date.localeCompare(right.date);
      if (dateCompare !== 0) return dateCompare;
      return String(left.startTime || "").localeCompare(String(right.startTime || ""));
    });

  if (!matchingTours.length) {
    marketingResults.hidden = true;
    marketingEmpty.hidden = false;
    marketingEmpty.textContent = "No tours found for this platform and these filters.";
    setStatus("");
    return;
  }

  marketingEmpty.hidden = true;
  marketingResults.hidden = false;
  marketingOverview.hidden = true;
  marketingPlatformDetail.hidden = false;
  renderPlatformDetail(matchingTours, selectedPlatform);
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
  await loadPlatformFilter();
  await runMarketingReport();
}

marketingStart?.addEventListener("change", invalidateMarketingResults);
marketingEnd?.addEventListener("change", invalidateMarketingResults);
marketingGuide?.addEventListener("change", invalidateMarketingResults);
marketingTourType?.addEventListener("change", invalidateMarketingResults);
marketingPlatform?.addEventListener("change", invalidateMarketingResults);

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
