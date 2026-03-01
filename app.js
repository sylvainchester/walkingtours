import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription, sendPush } from "./push.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const monthLabel = document.getElementById("monthLabel");
const calendarGrid = document.getElementById("calendarGrid");
const weekdayRow = document.getElementById("weekdayRow");
const detailsContent = document.getElementById("detailsContent");
const prevMonthBtn = document.getElementById("prevMonth");
const nextMonthBtn = document.getElementById("nextMonth");

const avatarButton = document.getElementById("avatarButton");
const avatarDropdown = document.getElementById("avatarDropdown");
const signInLink = document.getElementById("signInLink");
const signUpLink = document.getElementById("signUpLink");
const signOutBtn = document.getElementById("signOutBtn");
const shareLink = document.getElementById("shareLink");
const availabilityLink = document.getElementById("availabilityLink");
const guideFilter = document.getElementById("guideFilter");
const toursToggle = document.getElementById("toursToggle");
const tourModal = document.getElementById("tourModal");
const modalBody = document.getElementById("modalBody");
const modalClose = document.getElementById("modalClose");

const today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth();
let selectedDate = null;
let session = null;
let toursByDate = new Map();
let sharedGuideIds = new Set();
let sharedGuideProfiles = new Map();
let shareValidationByGuideId = new Map();
let unavailableDates = new Set();
let selectedGuideId = null;
let onlyMyTours = true;
let modalOpenTourId = null;
let tourTypes = [];
let html2pdfLoader = null;
let ocrBusy = false;

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
  (shareLink || avatarDropdown?.querySelector('a[href="share.html"]'))
    ?.classList.toggle("has-pending-dot", hasPending);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toISO(year, month, day) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function parseISO(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function monthTitle(year, month) {
  return new Date(year, month, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function firstWeekdayMonday0(year, month) {
  const js = new Date(year, month, 1).getDay();
  return (js + 6) % 7;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function getMonthRange(year, month) {
  const start = `${year}-${pad2(month + 1)}-01`;
  const end = `${year}-${pad2(month + 1)}-${pad2(daysInMonth(year, month))}`;
  return { start, end };
}

function dayStatus(count) {
  return count === 0 ? "green" : "orange";
}

function formatDateTitle(iso) {
  return parseISO(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function getTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function addMinutesToTime(value, minutesToAdd) {
  if (!value) return "";
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return "";
  const total = h * 60 + m + minutesToAdd;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${pad2(newH)}:${pad2(newM)}`;
}

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function computeInvoicePersons(participants) {
  if (!participants || participants.length === 0) return 0;
  const arrived = participants.filter((p) => p.attendance_status === "arrived");
  return arrived.reduce((sum, p) => sum + Number(p.group_size || 0), 0);
}

function replaceInvoiceTokens(template, values) {
  return template.replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (_match, key) => {
    return String(values[key] ?? "");
  });
}

async function loadHtml2Pdf() {
  if (window.html2pdf) return;
  if (html2pdfLoader) {
    await html2pdfLoader;
    return;
  }
  html2pdfLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  await html2pdfLoader;
}

async function loadGuideProfileById(guideId) {
  const cached = sharedGuideProfiles.get(guideId);
  if (cached?.sort_code !== undefined || cached?.account_number !== undefined || cached?.account_name !== undefined) {
    return cached;
  }
  const { data } = await supabase
    .from("guide_profiles")
    .select("id,first_name,last_name,email,sort_code,account_number,account_name")
    .eq("id", guideId)
    .maybeSingle();
  if (data) sharedGuideProfiles.set(guideId, data);
  return data || null;
}

async function loadTourTypeForTour(tour) {
  const { data } = await supabase
    .from("tour_types")
    .select("name,payment_type,ticket_price,commission_percent,fee_per_participant,invoice_org_name,invoice_org_address,platforms")
    .eq("guide_id", tour.guide_id)
    .eq("name", tour.type)
    .maybeSingle();
  if (data) return data;

  // Fallback: some existing tours may reference a shared type name owned by another guide.
  const { data: byName } = await supabase
    .from("tour_types")
    .select("guide_id,name,payment_type,ticket_price,commission_percent,fee_per_participant,invoice_org_name,invoice_org_address,platforms")
    .ilike("name", tour.type);
  if (!byName || byName.length === 0) return null;

  return byName.find((t) => t.guide_id === tour.guide_id)
    || byName.find((t) => t.guide_id === tour.created_by)
    || byName[0];
}

function extractEmail(value) {
  if (!value) return null;
  const match = String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

async function generateInvoicePdf(tour) {
  const [guideProfile, tourType] = await Promise.all([
    loadGuideProfileById(tour.guide_id),
    loadTourTypeForTour(tour),
  ]);

  const templateResponse = await fetch("./invoice.html", { cache: "no-store" });
  if (!templateResponse.ok) {
    throw new Error("Could not load invoice template.");
  }
  const template = await templateResponse.text();

  const personsTotal = computeInvoicePersons(tour.participants);
  const unitPrice = Number(
    tourType?.payment_type === "free"
      ? (tourType?.fee_per_participant ?? 0)
      : (tourType?.ticket_price ?? 0)
  );
  const commissionPct = Number(tourType?.commission_percent ?? 0);
  const gross = unitPrice * personsTotal;
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

  const html = replaceInvoiceTokens(template, {
    invoiceNo,
    guideFirstName: guideProfile?.first_name || "",
    guideLastName: guideProfile?.last_name || "",
    clientName: tourType?.invoice_org_name || "Invoice client",
    prettyDate,
    bookingRef,
    tourLabel: tour.type || "Tour",
    personsTotal,
    pricePerPerson: money(unitPrice),
    gross: money(gross),
    CommisionPct: commissionPct.toFixed(2),
    vicCommission: money(commission),
    total: money(total),
    bankPayeeName: guideProfile?.account_name || "",
    bankSortCode: guideProfile?.sort_code || "",
    bankAccountNumber: guideProfile?.account_number || "",
    bankEmail: guideProfile?.email || "",
  });

  const parsed = new DOMParser().parseFromString(html, "text/html");
  const styleText = Array.from(parsed.querySelectorAll("style"))
    .map((node) => node.textContent || "")
    .join("\n");
  const bodyHtml = parsed.body ? parsed.body.innerHTML : html;

  const mount = document.createElement("div");
  mount.style.position = "fixed";
  mount.style.left = "0";
  mount.style.top = "0";
  mount.style.width = "794px";
  mount.style.background = "#fff";
  mount.style.zIndex = "9999";
  mount.style.pointerEvents = "none";
  mount.innerHTML = `<style>${styleText}</style>${bodyHtml}`;

  // Template image link can expire; remove it to avoid render failures.
  mount.querySelectorAll("img").forEach((img) => img.remove());
  document.body.appendChild(mount);

  // Let the browser fully layout the injected invoice before capture.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  await loadHtml2Pdf();
  if (!window.html2canvas || !window.jspdf?.jsPDF) {
    document.body.removeChild(mount);
    throw new Error("PDF renderer not available.");
  }

  const canvas = await window.html2canvas(mount, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });

  const imgData = canvas.toDataURL("image/jpeg", 0.98);
  const pdf = new window.jspdf.jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const imgRatio = canvas.height / canvas.width;
  const targetWidth = pageWidth;
  const targetHeight = targetWidth * imgRatio;

  if (targetHeight <= pageHeight) {
    pdf.addImage(imgData, "JPEG", 0, 0, targetWidth, targetHeight);
  } else {
    let remaining = targetHeight;
    let y = 0;
    while (remaining > 0) {
      pdf.addImage(imgData, "JPEG", 0, y, targetWidth, targetHeight);
      remaining -= pageHeight;
      y -= pageHeight;
      if (remaining > 0) pdf.addPage();
    }
  }

  const blob = pdf.output("blob");

  document.body.removeChild(mount);
  return { blob, invoiceNo };
}

function toggleAuthUI(isAuthed) {
  if (signInLink) signInLink.style.display = isAuthed ? "none" : "block";
  if (signUpLink) signUpLink.style.display = isAuthed ? "none" : "block";
  if (signOutBtn) signOutBtn.style.display = isAuthed ? "block" : "none";
  if (shareLink) shareLink.style.display = isAuthed ? "block" : "none";
  if (availabilityLink) availabilityLink.style.display = isAuthed ? "block" : "none";
}

function closeMenu() {
  if (!avatarDropdown || !avatarButton) return;
  avatarDropdown.classList.remove("open");
  avatarButton.setAttribute("aria-expanded", "false");
}

function toggleMenu() {
  if (!avatarDropdown || !avatarButton) return;
  const isOpen = avatarDropdown.classList.contains("open");
  if (isOpen) {
    closeMenu();
  } else {
    avatarDropdown.classList.add("open");
    avatarButton.setAttribute("aria-expanded", "true");
  }
}

function isPrivateForViewer(tour) {
  return Boolean(tour?.is_private) && tour?.guide_id !== session?.user?.id;
}

async function loadSharedGuides() {
  sharedGuideIds = new Set();
  sharedGuideProfiles = new Map();
  shareValidationByGuideId = new Map();
  if (!session) return;
  sharedGuideIds.add(session.user.id);

  const { data, error } = await supabase
    .from("guide_shares")
    .select("guide_id,shared_with_id,requires_tour_validation")
    .or(`guide_id.eq.${session.user.id},shared_with_id.eq.${session.user.id}`);

  if (error || !data) return;

  data.forEach((row) => {
    if (row.guide_id) sharedGuideIds.add(row.guide_id);
    if (row.shared_with_id) sharedGuideIds.add(row.shared_with_id);
    if (row.guide_id === session.user.id && row.shared_with_id) {
      shareValidationByGuideId.set(row.shared_with_id, row.requires_tour_validation !== false);
    }
    if (row.shared_with_id === session.user.id && row.guide_id) {
      shareValidationByGuideId.set(row.guide_id, row.requires_tour_validation !== false);
    }
  });

  const { data: profiles, error: profileError } = await supabase
    .from("guide_profiles")
    .select("id,email,first_name,last_name")
    .in("id", Array.from(sharedGuideIds));

  if (profileError || !profiles) return;
  profiles.forEach((profile) => sharedGuideProfiles.set(profile.id, profile));

  if (!selectedGuideId || !sharedGuideIds.has(selectedGuideId)) {
    selectedGuideId = session.user.id;
  }
  buildGuideFilter();
}

async function loadTourTypes() {
  tourTypes = [];
  if (!session || sharedGuideIds.size === 0) return;
  const { data, error } = await supabase
    .from("tour_types")
    .select("id,guide_id,name,shareable,payment_type,fee_per_participant,platforms")
    .order("name");
  if (error || !data) return;
  tourTypes = data;
}

function buildGuideFilter() {
  if (!guideFilter) return;
  clearChildren(guideFilter);
  Array.from(sharedGuideIds).forEach((id) => {
    const profile = sharedGuideProfiles.get(id);
    const option = document.createElement("option");
    option.value = id;
    option.textContent = profile
      ? `${profile.first_name} ${profile.last_name}`
      : id;
    if (id === selectedGuideId) option.selected = true;
    guideFilter.appendChild(option);
  });
}

function getSortedGuideIds() {
  return Array.from(sharedGuideIds).sort((a, b) => {
    const profileA = sharedGuideProfiles.get(a);
    const profileB = sharedGuideProfiles.get(b);
    const nameA = profileA ? `${profileA.first_name || ""} ${profileA.last_name || ""}`.trim() : a;
    const nameB = profileB ? `${profileB.first_name || ""} ${profileB.last_name || ""}`.trim() : b;
    return nameA.localeCompare(nameB, "en", { sensitivity: "base" });
  });
}

function getGuideColorClass(guideId) {
  const orderedGuideIds = getSortedGuideIds();
  return orderedGuideIds.indexOf(guideId) === 1 ? "guide-color-2" : "guide-color-1";
}

function getAcceptedToursColorClass(tours) {
  const acceptedTours = (tours || []).filter((tour) => tour.status === "accepted");
  if (!acceptedTours.length) return "guide-color-1";
  const uniqueGuideIds = new Set(acceptedTours.map((tour) => tour.guide_id));
  if (uniqueGuideIds.size > 1) return "guide-color-1";
  return getGuideColorClass(acceptedTours[0].guide_id);
}

async function loadAvailabilityForSelectedGuide() {
  unavailableDates = new Set();
  if (!session || !selectedGuideId) return;
  const { start, end } = getMonthRange(viewYear, viewMonth);
  const { data } = await supabase
    .from("guide_availability")
    .select("date")
    .eq("guide_id", selectedGuideId)
    .gte("date", start)
    .lte("date", end)
    .eq("available", false);
  if (data) data.forEach((row) => unavailableDates.add(row.date));
}

async function loadMonthTours() {
  toursByDate = new Map();
  if (!session) {
    renderCalendar();
    if (selectedDate) showDetails(selectedDate);
    return;
  }

  await loadSharedGuides();
  await loadTourTypes();
  await loadAvailabilityForSelectedGuide();
  const guideIds = Array.from(sharedGuideIds);

  const { start, end } = getMonthRange(viewYear, viewMonth);
  const { data, error } = await supabase
    .from("tours")
    .select("id,date,start_time,end_time,type,platform,is_private,invoice_path,free_amount_received,platform_due_amount,participants(id,name,group_size,platform_name,attendance_status),guide_id,created_by,status,participants_locked")
    .gte("date", start)
    .lte("date", end)
    .in("guide_id", guideIds)
    .order("date")
    .order("start_time");

  if (error) {
    renderCalendar();
    return;
  }

  data.forEach((tour) => {
    const list = toursByDate.get(tour.date) || [];
    list.push(tour);
    toursByDate.set(tour.date, list);
  });

  renderCalendar();
  if (selectedDate) showDetails(selectedDate);
  if (modalOpenTourId) {
    const tour = findTourById(modalOpenTourId);
    if (tour) openTourModal(tour);
  }
}

function buildWeekdayRow() {
  clearChildren(weekdayRow);
  weekdayNames.forEach((name) => {
    const cell = document.createElement("div");
    cell.textContent = name;
    weekdayRow.appendChild(cell);
  });
}

function renderCalendar() {
  monthLabel.textContent = monthTitle(viewYear, viewMonth);
  clearChildren(calendarGrid);

  const todayISO = getTodayISO();
  const totalDays = daysInMonth(viewYear, viewMonth);
  const offset = firstWeekdayMonday0(viewYear, viewMonth);
  const cells = [];

  for (let i = 0; i < offset; i += 1) cells.push(null);
  for (let day = 1; day <= totalDays; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  cells.forEach((day, idx) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "day";
    cell.setAttribute("data-index", String(idx));

    if (day === null) {
      cell.classList.add("is-empty");
      cell.disabled = true;
      calendarGrid.appendChild(cell);
      return;
    }

    const iso = toISO(viewYear, viewMonth, day);
    const isPastDate = iso < todayISO;
    const tours = onlyMyTours
      ? (toursByDate.get(iso) || []).filter((t) => t.guide_id === session?.user?.id)
      : toursByDate.get(iso) || [];

    cell.textContent = String(day);
    cell.setAttribute("aria-label", `${iso}`);
    if (isPastDate) {
      cell.classList.add("past");
    } else if (unavailableDates.has(iso)) {
      cell.classList.add("unavailable");
    } else {
      cell.classList.add("available");
    }
    if (selectedDate === iso) cell.classList.add("selected");

    if (tours.length) {
      const indicator = document.createElement("div");
      const hasPending = tours.some((t) => t.status === "pending");
      indicator.className = `tour-indicator ${hasPending ? "pending" : `accepted ${getAcceptedToursColorClass(tours)}`}`;
      indicator.textContent = String(tours.length);
      cell.appendChild(indicator);
    }

    cell.addEventListener("click", () => {
      selectedDate = iso;
      renderCalendar();
      showDetails(iso);
    });

    calendarGrid.appendChild(cell);
  });
}

function createTourTypeSelect(value) {
  const select = document.createElement("select");
  select.className = "select";
  if (!tourTypes.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No tour types";
    select.appendChild(option);
    select.disabled = true;
    return select;
  }
  tourTypes.forEach((type) => {
    const option = document.createElement("option");
    option.value = type.id;
    option.textContent = type.name;
    if (value === type.id) option.selected = true;
    select.appendChild(option);
  });
  return select;
}

function getPlatformsForType(type) {
  if (!type) return [];
  return Array.isArray(type.platforms) ? type.platforms : [];
}

function findTourById(id) {
  for (const list of toursByDate.values()) {
    const tour = list.find((t) => t.id === id);
    if (tour) return tour;
  }
  return null;
}

function closeTourModal() {
  if (!tourModal) return;
  tourModal.classList.remove("open");
  tourModal.setAttribute("aria-hidden", "true");
  modalOpenTourId = null;
}

async function openTourModal(tour) {
  if (!tourModal || !modalBody) return;
  modalOpenTourId = tour.id;
  tourModal.classList.add("open");
  tourModal.setAttribute("aria-hidden", "false");
  await renderTourModal(tour);
}

async function renderTourModal(tour) {
  clearChildren(modalBody);

  const profile = sharedGuideProfiles.get(tour.guide_id);
  const guideName = profile
    ? `${profile.first_name} ${profile.last_name}`
    : "Unknown";
  const isPast = tour.date < getTodayISO();
  const isPrivate = isPrivateForViewer(tour);

  const headerRow = document.createElement("div");
  headerRow.className = `tour-row ${tour.status === "pending" ? "pending" : "accepted"}`;
  headerRow.textContent = `${(tour.start_time || "").slice(0, 5)} - ${(tour.end_time || "").slice(0, 5)} · ${guideName} · ${isPrivate ? "Private tour" : tour.type}`;
  modalBody.appendChild(headerRow);

  const isOwner = session && tour.guide_id === session.user.id;
  const isCreator = session && tour.created_by === session.user.id;
  const canManageLock = Boolean(session) && (isOwner || isCreator);
  const isLocked = Boolean(tour.participants_locked);
  const canEditParticipants = Boolean(session) && tour.status === "accepted" && !isPast && !isLocked && !isPrivate;
  const canDeleteTour = Boolean(session) && !isPast && (isOwner || isCreator);
  const canEditTourGuide = Boolean(session) && !isPast && !isLocked && !isPrivate && (isOwner || isCreator);
  const typeForTour = tourTypes.find((t) => t.guide_id === tour.guide_id && t.name === tour.type)
    || await loadTourTypeForTour(tour)
    || null;
  const platformForTour = tour.platform || getPlatformsForType(typeForTour)[0] || null;
  const participantPlatforms = getPlatformsForType(typeForTour);
  const isFreeTour = typeForTour?.payment_type === "free" || /free/i.test(String(tour.type || ""));
  const feePerParticipant = Number(platformForTour?.commission_percent || typeForTour?.fee_per_participant || 0);
  const unresolvedParticipants = (tour.participants || []).filter(
    (p) => p.attendance_status !== "arrived" && p.attendance_status !== "absent"
  );
  const arrivedParticipants = (tour.participants || []).filter(
    (p) => p.attendance_status === "arrived"
  );
  const arrivedPersonsCount = arrivedParticipants.reduce(
    (sum, p) => sum + Number(p.group_size || 0),
    0
  );
  const canLockParticipants = Boolean(session)
    && tour.status === "accepted"
    && !isPast
    && !isLocked
    && !isPrivate
    && unresolvedParticipants.length === 0
    && arrivedParticipants.length > 0
    && (isOwner || isCreator);

  if (canEditTourGuide) {
    const guideRow = document.createElement("div");
    guideRow.className = "form-row";

    const guideLabel = document.createElement("div");
    guideLabel.className = "muted participant-platform-label";
    guideLabel.textContent = "Guide";
    guideRow.appendChild(guideLabel);

    const guideSelect = document.createElement("select");
    guideSelect.className = "select";
    Array.from(sharedGuideIds).forEach((guideId) => {
      const option = document.createElement("option");
      const guideProfile = sharedGuideProfiles.get(guideId);
      option.value = guideId;
      option.textContent = guideProfile
        ? `${guideProfile.first_name} ${guideProfile.last_name}`
        : guideId;
      if (guideId === tour.guide_id) option.selected = true;
      guideSelect.appendChild(option);
    });
    guideRow.appendChild(guideSelect);

    const saveGuideBtn = document.createElement("button");
    saveGuideBtn.type = "button";
    saveGuideBtn.className = "ghost";
    saveGuideBtn.textContent = "Save guide";
    saveGuideBtn.addEventListener("click", async () => {
      const nextGuideId = guideSelect.value;
      if (!nextGuideId || nextGuideId === tour.guide_id) return;

      const validationRequired = nextGuideId === session.user.id
        ? false
        : (shareValidationByGuideId.get(nextGuideId) ?? true);
      const nextStatus = nextGuideId === session.user.id || !validationRequired ? "accepted" : "pending";

      const { data: conflicts, error: conflictError } = await supabase
        .from("tours")
        .select("id")
        .eq("guide_id", nextGuideId)
        .eq("date", tour.date)
        .neq("id", tour.id)
        .lte("start_time", tour.end_time)
        .gte("end_time", tour.start_time);
      if (conflictError) {
        alert(`Conflict check error: ${conflictError.message}`);
        return;
      }
      if (conflicts && conflicts.length > 0) {
        alert("This guide already has another tour at the same time.");
        return;
      }

      const previousGuideId = tour.guide_id;
      const previousGuideName = guideName;
      const nextGuideProfile = sharedGuideProfiles.get(nextGuideId);
      const nextGuideName = nextGuideProfile
        ? `${nextGuideProfile.first_name} ${nextGuideProfile.last_name}`
        : "Unknown";

      const { error } = await supabase
        .from("tours")
        .update({ guide_id: nextGuideId, status: nextStatus })
        .eq("id", tour.id);
      if (error) {
        alert(`Guide update error: ${error.message}`);
        return;
      }

      if (previousGuideId !== session.user.id) {
        await sendPush(supabase, {
          to_user_id: previousGuideId,
          title: "Tour reassigned",
          body: `A tour on ${tour.date} is no longer assigned to you.`,
          data: { url: "./index.html" },
        });
      }
      if (nextGuideId !== session.user.id) {
        await sendPush(supabase, {
          to_user_id: nextGuideId,
          title: nextStatus === "pending" ? "Tour reassignment pending" : "Tour reassigned",
          body: nextStatus === "pending"
            ? `${previousGuideName} reassigned a tour to you on ${tour.date}.`
            : `${previousGuideName} reassigned a tour to ${nextGuideName === previousGuideName ? "you" : nextGuideName} on ${tour.date}.`,
          data: { url: "./index.html" },
        });
      }

      await loadMonthTours();
    });
    guideRow.appendChild(saveGuideBtn);
    modalBody.appendChild(guideRow);
  }

  const handleDeleteTour = async () => {
    if (!confirm("Delete this tour?")) return;
    if (tour.invoice_path) {
      const { error: storageError } = await supabase.storage
        .from("invoices")
        .remove([tour.invoice_path]);
      if (storageError) {
        alert(`Invoice delete error: ${storageError.message}`);
        return;
      }
    }
    const { data: deletedRows, error } = await supabase
      .from("tours")
      .delete()
      .eq("id", tour.id)
      .select("id,guide_id,created_by,date");
    if (error) {
      alert(`Delete error: ${error.message}`);
      return;
    }
    if (!deletedRows || deletedRows.length === 0) {
      alert("Delete failed: not allowed.");
      return;
    }

    const deleted = deletedRows[0];
    const notifyTarget =
      deleted.created_by === session.user.id && deleted.guide_id !== session.user.id
        ? deleted.guide_id
        : deleted.guide_id === session.user.id && deleted.created_by && deleted.created_by !== session.user.id
          ? deleted.created_by
          : null;
    if (notifyTarget) {
      await sendPush(supabase, {
        to_user_id: notifyTarget,
        title: "Tour removed",
        body: `A planned tour on ${deleted.date} was deleted.`,
        data: { url: "./index.html" },
      });
    }
    closeTourModal();
    await loadMonthTours();
  };

  if (tour.status === "pending" && isOwner) {
    const actions = document.createElement("div");
    actions.className = "form-row";

    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "primary";
    acceptBtn.textContent = "Accept";
    acceptBtn.addEventListener("click", async () => {
      const { error } = await supabase
        .from("tours")
        .update({ status: "accepted" })
        .eq("id", tour.id);
      if (!error) {
        if (tour.created_by && tour.created_by !== session.user.id) {
          await sendPush(supabase, {
            to_user_id: tour.created_by,
            title: "Tour accepted",
            body: `${guideName} accepted the tour on ${tour.date}.`,
            data: { url: "./index.html" },
          });
        }
        await loadMonthTours();
      }
    });

    const declineBtn = document.createElement("button");
    declineBtn.type = "button";
    declineBtn.className = "ghost";
    declineBtn.textContent = "Decline";
    declineBtn.addEventListener("click", async () => {
      if (!confirm("Decline this tour? It will be removed.")) return;
      const { error } = await supabase.from("tours").delete().eq("id", tour.id);
      if (!error) {
        if (tour.created_by && tour.created_by !== session.user.id) {
          await sendPush(supabase, {
            to_user_id: tour.created_by,
            title: "Tour declined",
            body: `${guideName} declined the tour on ${tour.date}.`,
            data: { url: "./index.html" },
          });
        }
        closeTourModal();
        await loadMonthTours();
      }
    });

    actions.appendChild(acceptBtn);
    actions.appendChild(declineBtn);
    modalBody.appendChild(actions);
  }

  if (isPrivate) {
    const privateNote = document.createElement("div");
    privateNote.className = "muted";
    privateNote.textContent = "This tour is private.";
    modalBody.appendChild(privateNote);
    return;
  }

  const participantsTitle = document.createElement("div");
  participantsTitle.className = "details-title";
  participantsTitle.textContent = "Participants";
  modalBody.appendChild(participantsTitle);

  const list = document.createElement("div");
  list.className = "details-content";

  if (!tour.participants || tour.participants.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "No participants yet.";
    list.appendChild(empty);
  } else {
    tour.participants.forEach((p) => {
      const row = document.createElement("div");
      row.className = `participant${p.attendance_status ? ` ${p.attendance_status}` : ""}`;

      const name = document.createElement("div");
      name.textContent = `${p.name} (${p.group_size})${p.platform_name ? ` · ${p.platform_name}` : ""}`;
      row.appendChild(name);

      if (canEditParticipants) {
        const actions = document.createElement("div");
        actions.className = "form-row";

        const arrivedBtn = document.createElement("button");
        arrivedBtn.type = "button";
        arrivedBtn.className = "ghost";
        arrivedBtn.textContent = "✓";
        arrivedBtn.title = "Arrived";
        arrivedBtn.addEventListener("click", async () => {
          const { error } = await supabase
            .from("participants")
            .update({ attendance_status: "arrived" })
            .eq("id", p.id);
          if (!error) await loadMonthTours();
        });

        const absentBtn = document.createElement("button");
        absentBtn.type = "button";
        absentBtn.className = "ghost danger";
        absentBtn.textContent = "✕";
        absentBtn.title = "No show";
        absentBtn.addEventListener("click", async () => {
          const { error } = await supabase
            .from("participants")
            .update({ attendance_status: "absent" })
            .eq("id", p.id);
          if (!error) await loadMonthTours();
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "ghost danger";
        removeBtn.textContent = "−";
        removeBtn.title = "Delete participant";
        removeBtn.addEventListener("click", async () => {
          if (!confirm("Delete this participant?")) return;
          const { error } = await supabase
            .from("participants")
            .delete()
            .eq("id", p.id);
          if (!error) await loadMonthTours();
        });

        actions.appendChild(arrivedBtn);
        actions.appendChild(absentBtn);
        actions.appendChild(removeBtn);
        row.appendChild(actions);
      }

      list.appendChild(row);
    });
  }

  if (canEditParticipants) {
    const platformRow = document.createElement("div");
    platformRow.className = "form-row";

    const platformLabel = document.createElement("div");
    platformLabel.className = "muted participant-platform-label";
    platformLabel.textContent = "Platform";
    platformRow.appendChild(platformLabel);

    const participantPlatformSelect = document.createElement("select");
    participantPlatformSelect.className = "select";
    if (!participantPlatforms.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No platform configured";
      option.selected = true;
      participantPlatformSelect.appendChild(option);
      participantPlatformSelect.disabled = true;
    } else {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select platform";
      placeholder.selected = !platformForTour;
      participantPlatformSelect.appendChild(placeholder);
      participantPlatforms.forEach((platform) => {
        const option = document.createElement("option");
        option.value = platform.name || "";
        option.textContent = platform.name || "";
        if (platformForTour && platform.name === platformForTour.name) option.selected = true;
        participantPlatformSelect.appendChild(option);
      });
    }
    platformRow.appendChild(participantPlatformSelect);
    list.appendChild(platformRow);

    const importRow = document.createElement("div");
    importRow.className = "form-row";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "ghost";
    importBtn.textContent = ocrBusy ? "Importing..." : "Import participants from screenshot";
    importBtn.disabled = ocrBusy;
    importBtn.addEventListener("click", () => fileInput.click());

    const importStatus = document.createElement("div");
    importStatus.className = "muted";

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      ocrBusy = true;
      importBtn.textContent = "Importing...";
      importBtn.disabled = true;
      importStatus.textContent = "Reading image...";

      try {
        const participants = await extractParticipantsFromImage(file);
        if (!participants.length) {
          importStatus.textContent = "No participants found.";
        } else {
          importStatus.textContent = `Found ${participants.length} participants.`;
          const platformName = participantPlatformSelect.value || null;
          if (!platformName) {
            importStatus.textContent = "Select a platform first.";
            return;
          }
          if (confirm(`Import ${participants.length} participants?`)) {
            const { error } = await supabase.from("participants").insert(
              participants.map((p) => ({
                tour_id: tour.id,
                name: p.name,
                group_size: p.group_size,
                platform_name: platformName,
              }))
            );
            if (!error) {
              await loadMonthTours();
            }
          }
        }
      } catch (err) {
        importStatus.textContent = "Import failed.";
      } finally {
        ocrBusy = false;
        importBtn.textContent = "Import participants from screenshot";
        importBtn.disabled = false;
        fileInput.value = "";
      }
    });

    importRow.appendChild(importBtn);
    importRow.appendChild(importStatus);
    list.appendChild(importRow);
    list.appendChild(fileInput);

    const form = document.createElement("div");
    form.className = "form-row participant-add-row";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Participant name";
    nameInput.className = "input";

    const groupInput = document.createElement("input");
    groupInput.type = "number";
    groupInput.min = "1";
    groupInput.value = "1";
    groupInput.className = "input";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "primary";
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const groupSize = Number(groupInput.value || 1);
      const selectedPlatformName = participantPlatformSelect.value || null;
      if (!name) return;
      if (!selectedPlatformName) {
        alert("Select a platform first.");
        return;
      }
      const { error } = await supabase.from("participants").insert({
        tour_id: tour.id,
        name,
        group_size: groupSize,
        platform_name: selectedPlatformName,
      });
      if (!error) {
        nameInput.value = "";
        groupInput.value = "1";
        await loadMonthTours();
      }
    });

    form.appendChild(nameInput);
    form.appendChild(groupInput);
    form.appendChild(addBtn);
    list.appendChild(form);
  }

  modalBody.appendChild(list);

  const footerActions = document.createElement("div");
  footerActions.className = "form-row modal-footer-actions";

  if (canManageLock && !isLocked) {
    const lockBtn = document.createElement("button");
    lockBtn.type = "button";
    lockBtn.className = "ghost danger";
    lockBtn.textContent = "Lock participants";
    lockBtn.disabled = !canLockParticipants;
    lockBtn.addEventListener("click", async () => {
      if (!canLockParticipants) return;
      if (!confirm("Lock participants permanently? This cannot be undone.")) return;
      const updatePayload = { participants_locked: true };
      try {
        const liveType = typeForTour || await loadTourTypeForTour(tour);
        const nameSuggestsFree = /free/i.test(String(tour.type || ""));
        const liveIsFreeTour = liveType?.payment_type === "free" || nameSuggestsFree;
        const livePlatform = tour.platform || getPlatformsForType(liveType)[0] || null;
        const liveFeePerParticipant = Number(livePlatform?.commission_percent || liveType?.fee_per_participant || feePerParticipant || 0);

        if (liveIsFreeTour) {
          const typeFromDb = await loadTourTypeForTour(tour);
          const dbPlatform = tour.platform || getPlatformsForType(typeFromDb)[0] || null;
          const effectiveFee = Number(dbPlatform?.commission_percent ?? typeFromDb?.fee_per_participant ?? liveFeePerParticipant ?? 0);
          if (!Number.isFinite(effectiveFee) || effectiveFee <= 0) {
            alert("Fee per participant is missing for this free tour.");
            return;
          }
          updatePayload.free_amount_received = null;
          updatePayload.platform_due_amount = Number((arrivedPersonsCount * effectiveFee).toFixed(2));
        } else {
          const effectivePlatform = tour.platform || getPlatformsForType(liveType)[0] || null;
          if (!effectivePlatform) {
            alert("No platform is configured for this pre-paid tour.");
            return;
          }
          updatePayload.free_amount_received = null;
          updatePayload.platform_due_amount = null;
        }
      } catch (lockError) {
        alert(`Lock error: ${lockError?.message || lockError}`);
        return;
      }
      const { error } = await supabase
        .from("tours")
        .update(updatePayload)
        .eq("id", tour.id);
      if (!error) {
        await loadMonthTours();
      }
    });
    footerActions.appendChild(lockBtn);
    if (!canLockParticipants) {
      const reason = document.createElement("div");
      reason.className = "muted";
      if (tour.status !== "accepted") {
        reason.textContent = "Lock is available only after tour acceptance.";
      } else if (isPast) {
        reason.textContent = "Past tours cannot be locked.";
      } else if (isPrivate) {
        reason.textContent = "Private tours cannot be locked.";
      } else if (unresolvedParticipants.length > 0) {
        reason.textContent = "Set each participant as arrived or no-show before locking.";
      } else if (arrivedParticipants.length === 0) {
        reason.textContent = "At least one participant must be marked as arrived.";
      }
      footerActions.appendChild(reason);
    }
  } else if (isLocked) {
    const lockedNote = document.createElement("div");
    lockedNote.className = "muted";
    lockedNote.textContent = "Participants are locked.";
    modalBody.appendChild(lockedNote);
    if (isFreeTour) {
      const freeRow = document.createElement("div");
      freeRow.className = "form-row";

      const amountInput = document.createElement("input");
      amountInput.type = "number";
      amountInput.min = "0";
      amountInput.step = "0.01";
      amountInput.className = "input";
      amountInput.placeholder = "Amount received from participants";
      amountInput.value = tour.free_amount_received == null ? "" : String(tour.free_amount_received);

      const saveAmountBtn = document.createElement("button");
      saveAmountBtn.type = "button";
      saveAmountBtn.className = "ghost";
      saveAmountBtn.textContent = "Save amount";
      saveAmountBtn.addEventListener("click", async () => {
        const amount = Number(amountInput.value || "");
        if (!Number.isFinite(amount) || amount < 0) {
          alert("Enter a valid amount received.");
          return;
        }
        const { error } = await supabase
          .from("tours")
          .update({ free_amount_received: amount })
          .eq("id", tour.id);
        if (error) {
          alert(`Save amount error: ${error.message}`);
          return;
        }
        await loadMonthTours();
      });

      freeRow.appendChild(amountInput);
      freeRow.appendChild(saveAmountBtn);
      modalBody.appendChild(freeRow);

      const computedPlatformDue = Number((arrivedPersonsCount * feePerParticipant).toFixed(2));
      const platformDue = computedPlatformDue > 0
        ? computedPlatformDue
        : Number(tour.platform_due_amount || 0);
      const displayUnitFee = arrivedPersonsCount > 0
        ? Number((platformDue / arrivedPersonsCount).toFixed(2))
        : Number(feePerParticipant || 0);
      const dueText = document.createElement("div");
      dueText.className = "platform-due-note";
      dueText.textContent = `Platform due: ${money(platformDue)} (${arrivedPersonsCount} participant${arrivedPersonsCount === 1 ? "" : "s"} x ${money(displayUnitFee)})`;
      modalBody.appendChild(dueText);
    }
  } else if (tour.status !== "accepted") {
    const pendingNote = document.createElement("div");
    pendingNote.className = "muted";
    pendingNote.textContent = "Lock is available only after tour acceptance.";
    modalBody.appendChild(pendingNote);
  }

  if (canDeleteTour) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ghost";
    deleteBtn.textContent = "Delete tour";
    deleteBtn.addEventListener("click", handleDeleteTour);
    footerActions.appendChild(deleteBtn);
  }

  if (footerActions.childElementCount > 0) {
    modalBody.appendChild(footerActions);
  }
}

async function loadTesseract() {
  if (window.Tesseract) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function parseParticipantsFromText(text) {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const ignore = /reservas|buscar|gu[ií]a|selecciona|enviar|mensaje|difusi[oó]n|evento|confirmado|disponible/i;
  const participants = [];
  let pendingName = null;

  const extractGroupSize = (line) => {
    const matches = Array.from(line.matchAll(/(\d+)\s*(adult|adults|niñ|nino|niño|nina|niña)/gi));
    if (!matches.length) return 0;
    return matches.reduce((sum, m) => sum + Number(m[1]), 0);
  };

  const cleanName = (line) => {
    let name = line;
    name = name.replace(/^\W*\d+\s+/, ""); // remove leading index number
    name = name.replace(/\s*(\d+\s*(adult|adults|niñ|nino|niño|nina|niña).*)$/i, "");
    name = name.replace(/^[\[\(]+|[\]\)]+$/g, "").trim();
    return name;
  };

  for (const line of lines) {
    if (ignore.test(line)) continue;

    const groupSize = extractGroupSize(line);
    if (groupSize > 0) {
      const name = cleanName(line);
      if (name.length >= 2) {
        participants.push({ name, group_size: groupSize });
        pendingName = null;
        continue;
      }
      if (pendingName) {
        participants.push({ name: pendingName, group_size: groupSize });
        pendingName = null;
      }
      continue;
    }

    // likely a name line
    if (!/\d/.test(line) && line.length >= 2) {
      pendingName = line;
    }
  }

  return participants;
}

async function extractParticipantsFromImage(file) {
  await loadTesseract();
  const { data } = await window.Tesseract.recognize(file, "spa+por+eng");
  console.log("OCR_TEXT_START");
  console.log(data.text || "");
  console.log("OCR_TEXT_END");
  return parseParticipantsFromText(data.text || "");
}

function renderTourItem(tour) {
  const profile = sharedGuideProfiles.get(tour.guide_id);
  const guideName = profile
    ? `${profile.first_name} ${profile.last_name}`
    : "Unknown";

  const tourIsPast = tour.date < getTodayISO();
  const isPrivate = isPrivateForViewer(tour);
  const row = document.createElement("button");
  const acceptedColorClass = tour.status === "accepted" ? ` ${getGuideColorClass(tour.guide_id)}` : "";
  row.className = `tour-row ${tour.status === "pending" ? "pending" : "accepted"}${acceptedColorClass}${tourIsPast ? " past" : ""}`;
  row.type = "button";
  row.addEventListener("click", () => openTourModal(tour));

  const time = (tour.start_time || "").slice(0, 5);
  const text = document.createElement("div");
  text.textContent = `${time} · ${guideName} · ${isPrivate ? "Private tour" : tour.type}`;

  row.appendChild(text);
  return row;
}

async function showDetails(iso) {
  clearChildren(detailsContent);

  const title = document.createElement("div");
  title.className = "details-title";
  const pretty = new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  title.textContent = `Selected day · ${pretty}`;
  detailsContent.appendChild(title);

  if (!session) {
    const notice = document.createElement("div");
    const link = document.createElement("a");
    link.href = "sign-in.html";
    link.textContent = "Sign in to manage tours.";
    notice.appendChild(link);
    detailsContent.appendChild(notice);
    return;
  }

  const tours = toursByDate.get(iso) || [];

  const todayISO = getTodayISO();
  const isPastDate = iso < todayISO;

  const createCard = document.createElement("div");
  createCard.className = "card";

  const createTitle = document.createElement("div");
  createTitle.className = "details-title";
  createTitle.textContent = "Create Tour";

  const createForm = document.createElement("div");
  createForm.className = "form-row";

  let availableGuideIds = new Set();
  if (sharedGuideIds.size > 0) {
    const { data: unavailableRows } = await supabase
      .from("guide_availability")
      .select("guide_id")
      .in("guide_id", Array.from(sharedGuideIds))
      .eq("date", iso)
      .eq("available", false);
    const unavailableGuideIds = new Set((unavailableRows || []).map((r) => r.guide_id));
    availableGuideIds = new Set(
      Array.from(sharedGuideIds).filter((guideId) => !unavailableGuideIds.has(guideId))
    );
  }

  const guideSelect = document.createElement("select");
  guideSelect.className = "select";
  Array.from(sharedGuideIds).forEach((id) => {
    if (!availableGuideIds.has(id)) return;
    const profile = sharedGuideProfiles.get(id);
    const option = document.createElement("option");
    option.value = id;
    option.textContent = profile
      ? `${profile.first_name} ${profile.last_name}`
      : id;
    if (session && id === session.user.id) option.selected = true;
    guideSelect.appendChild(option);
  });
  const hasAvailableGuide = guideSelect.options.length > 0;
  if (!hasAvailableGuide) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No guide available";
    option.selected = true;
    guideSelect.appendChild(option);
    guideSelect.disabled = true;
  }

  const startInput = document.createElement("input");
  startInput.type = "time";
  startInput.className = "input time-input";
  startInput.value = "10:30";

  const typeSelect = createTourTypeSelect(tourTypes[0]?.id);
  const platformSelect = document.createElement("select");
  platformSelect.className = "select";

  const refreshPlatformSelect = () => {
    clearChildren(platformSelect);
    const selectedType = tourTypes.find((type) => type.id === typeSelect.value);
    const platforms = getPlatformsForType(selectedType);
    const needsPlatform = Boolean(selectedType);

    if (!needsPlatform) {
      const option = document.createElement("option");
        option.value = "";
        option.textContent = "No platform";
      option.selected = true;
      platformSelect.appendChild(option);
      platformSelect.disabled = true;
      platformSelect.style.display = "none";
      return;
    }

    platformSelect.style.display = "";
    if (!platforms.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No platform configured";
      option.selected = true;
      platformSelect.appendChild(option);
      platformSelect.disabled = true;
      return;
    }

    platformSelect.disabled = false;
    platforms.forEach((platform) => {
      const option = document.createElement("option");
      option.value = platform.id || platform.name;
      option.textContent = platform.name || "Platform";
      platformSelect.appendChild(option);
    });
  };
  refreshPlatformSelect();
  typeSelect.addEventListener("change", refreshPlatformSelect);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "primary";
  addBtn.textContent = "Add tour";
  addBtn.disabled = !hasAvailableGuide;
  addBtn.addEventListener("click", async () => {
    if (!tourTypes.length) {
      alert("Please create a tour type first.");
      return;
    }
    if (!hasAvailableGuide) {
      alert("No guide is available for this day.");
      return;
    }
    if (!startInput.value) {
      alert("Please fill start time.");
      return;
    }
    const endValue = addMinutesToTime(startInput.value, 90);
    const selectedGuide = guideSelect.value || session.user.id;
    const selectedType = tourTypes.find((type) => type.id === typeSelect.value);
    if (!selectedType) {
      alert("Please select a tour type.");
      return;
    }
    const selectedPlatform = getPlatformsForType(selectedType)
      .find((platform) => (platform.id || platform.name) === platformSelect.value) || null;
    if (!selectedPlatform) {
      alert("Please select a platform.");
      return;
    }
    const needsValidation = selectedGuide === session.user.id
      ? false
      : shareValidationByGuideId.get(selectedGuide) !== false;
    const status = needsValidation ? "pending" : "accepted";
    const { data: conflicts } = await supabase
      .from("tours")
      .select("id,start_time,end_time,status")
      .eq("guide_id", selectedGuide)
      .eq("date", iso)
      .eq("status", "accepted")
      .lte("start_time", endValue)
      .gte("end_time", startInput.value);
    if (conflicts && conflicts.length > 0) {
      alert("Time conflict with another accepted tour.");
      return;
    }
    const { error } = await supabase.from("tours").insert({
      guide_id: selectedGuide,
      created_by: session.user.id,
      status,
      date: iso,
      start_time: startInput.value,
      end_time: endValue,
      type: selectedType.name,
      is_private: selectedType.shareable === false,
      platform: selectedPlatform,
    });
    if (!error) {
      if (selectedGuide !== session.user.id) {
        await sendPush(supabase, {
          to_user_id: selectedGuide,
          title: needsValidation ? "New tour pending" : "New tour booked",
          body: needsValidation
            ? `A tour is waiting for your approval on ${iso} at ${(startInput.value || "").slice(0, 5)}.`
            : `A new tour was booked for you on ${iso} at ${(startInput.value || "").slice(0, 5)}.`,
          data: { url: "./index.html" },
        });
      }
      await loadMonthTours();
    }
  });

  createForm.appendChild(startInput);
  createForm.appendChild(typeSelect);
  createForm.appendChild(platformSelect);
  createForm.appendChild(guideSelect);
  createForm.appendChild(addBtn);

  if (!isPastDate) {
    createCard.appendChild(createTitle);
    createCard.appendChild(createForm);
    if (!hasAvailableGuide) {
      const unavailableNote = document.createElement("div");
      unavailableNote.className = "muted";
      unavailableNote.textContent = "No available guide for this day. Update availability first.";
      createCard.appendChild(unavailableNote);
    }
    detailsContent.appendChild(createCard);
  }

  const listCard = document.createElement("div");
  listCard.className = "card";
  const listTitle = document.createElement("div");
  listTitle.className = "details-title";
  listTitle.textContent = "Tours";
  listCard.appendChild(listTitle);

  if (!tours.length) {
    const empty = document.createElement("div");
    empty.textContent = "No tours scheduled.";
    listCard.appendChild(empty);
  } else {
    tours.forEach((tour) => {
      listCard.appendChild(renderTourItem(tour));
    });
  }

  detailsContent.appendChild(listCard);
}

async function handleAuthSignOut() {
  await supabase.auth.signOut();
  closeMenu();
  window.location.href = "sign-in.html";
}

function bindAuth() {
  if (signOutBtn) signOutBtn.addEventListener("click", handleAuthSignOut);
  if (avatarButton) avatarButton.addEventListener("click", toggleMenu);
  if (modalClose) modalClose.addEventListener("click", closeTourModal);
  if (tourModal) {
    tourModal.addEventListener("click", (event) => {
      if (event.target && event.target.dataset && event.target.dataset.close === "true") {
        closeTourModal();
      }
    });
  }
  document.addEventListener("click", (event) => {
    if (!avatarDropdown || !avatarButton) return;
    if (avatarDropdown.contains(event.target) || avatarButton.contains(event.target)) return;
    closeMenu();
  });

  if (guideFilter) {
    guideFilter.addEventListener("change", async (event) => {
      selectedGuideId = event.target.value;
      await loadAvailabilityForSelectedGuide();
      renderCalendar();
    });
  }

  if (toursToggle) {
    toursToggle.textContent = onlyMyTours ? "My tours" : "All tours";
    toursToggle.classList.toggle("only", onlyMyTours);
    toursToggle.addEventListener("click", () => {
      onlyMyTours = !onlyMyTours;
      toursToggle.textContent = onlyMyTours ? "My tours" : "All tours";
      toursToggle.classList.toggle("only", onlyMyTours);
      renderCalendar();
    });
  }
}

async function initAuth() {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (!session) {
    window.location.href = "sign-in.html";
    return;
  }
  toggleAuthUI(Boolean(session));
  await ensurePushSubscription(supabase, session);
  await refreshShareInviteIndicators();
  await loadMonthTours();

  supabase.auth.onAuthStateChange((_event, newSession) => {
    session = newSession;
    toggleAuthUI(Boolean(session));
    if (!session) {
      window.location.href = "sign-in.html";
      return;
    }
    ensurePushSubscription(supabase, session);
    refreshShareInviteIndicators();
    loadMonthTours();
  });
}

prevMonthBtn.addEventListener("click", async () => {
  viewMonth -= 1;
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear -= 1;
  }
  await loadMonthTours();
});

nextMonthBtn.addEventListener("click", async () => {
  viewMonth += 1;
  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear += 1;
  }
  await loadMonthTours();
});

buildWeekdayRow();
bindAuth();
initAuth();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}
