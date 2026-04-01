import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription, sendPush } from "./push.js";
import { createTourModalController } from "./tour-modal-controller.js";
import { applyAcceptedTourStyle } from "./tour-colors.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GUIDE_COLOR_CLASSES = [
  "guide-color-1",
  "guide-color-2",
  "guide-color-3",
  "guide-color-4",
  "guide-color-5",
];

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
let monthTours = [];
let sharedGuideIds = new Set();
let sharedGuideProfiles = new Map();
let shareValidationByGuideId = new Map();
let monthUnavailableGuideIdsByDate = new Map();
let unavailableDates = new Set();
let selectedGuideId = null;
let showAllTours = true;
let tourTypes = [];
let viewerColorMode = "auto";
let viewerGuideColorOverrides = {};
let ocrBusy = false;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function toISO(year, month, day) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function parseISO(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function monthTitle(year, month) {
  return new Date(year, month, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function firstWeekdayMonday0(year, month) {
  return (new Date(year, month, 1).getDay() + 6) % 7;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getMonthRange(year, month) {
  const start = `${year}-${pad2(month + 1)}-01`;
  const end = `${year}-${pad2(month + 1)}-${pad2(daysInMonth(year, month))}`;
  return { start, end };
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

function getTourTypePricePerPerson(type, platform) {
  if (!type) return 0;
  if (type.payment_type === "free") {
    return Number(platform?.commission_percent ?? type.fee_per_participant ?? 0);
  }
  return Number(type.ticket_price ?? 0);
}

function formatShortDateNoYear(iso) {
  const date = parseISO(iso);
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const mod100 = day % 100;
  let suffix = "th";
  if (mod100 < 11 || mod100 > 13) {
    if (day % 10 === 1) suffix = "st";
    else if (day % 10 === 2) suffix = "nd";
    else if (day % 10 === 3) suffix = "rd";
  }
  return `${day}${suffix} ${month}`;
}

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function isPrivateForViewer(tour) {
  return Boolean(tour?.is_private) && tour?.guide_id !== session?.user?.id;
}

function getOrderedGuideIds() {
  const ids = Array.from(sharedGuideIds);
  return ids.sort((leftId, rightId) => {
    if (leftId === session?.user?.id) return -1;
    if (rightId === session?.user?.id) return 1;
    const leftProfile = sharedGuideProfiles.get(leftId);
    const rightProfile = sharedGuideProfiles.get(rightId);
    const leftName = `${leftProfile?.first_name || ""} ${leftProfile?.last_name || ""}`.trim() || leftId;
    const rightName = `${rightProfile?.first_name || ""} ${rightProfile?.last_name || ""}`.trim() || rightId;
    return leftName.localeCompare(rightName, "en", { sensitivity: "base" });
  });
}

function getGuideColorIndex(guideId) {
  const index = getOrderedGuideIds().indexOf(guideId);
  return index === -1 ? 0 : Math.min(index, GUIDE_COLOR_CLASSES.length - 1);
}

function normalizeGuideColorClass(value) {
  const colorClass = String(value || "").trim();
  return GUIDE_COLOR_CLASSES.includes(colorClass) ? colorClass : null;
}

function getGuideColorClass(guideId) {
  if (viewerColorMode === "custom") {
    const customClass = normalizeGuideColorClass(viewerGuideColorOverrides?.[guideId]);
    if (customClass) return customClass;
  }
  return GUIDE_COLOR_CLASSES[getGuideColorIndex(guideId)] || GUIDE_COLOR_CLASSES[0];
}

function getGuideColorValue(guideId) {
  const map = {
    "guide-color-1": "#1e6f3a",
    "guide-color-2": "#1f4f8f",
    "guide-color-3": "#c04a8b",
    "guide-color-4": "#6f42b5",
    "guide-color-5": "#7a4a21",
  };
  return map[getGuideColorClass(guideId)] || map["guide-color-1"];
}

function updateGuideFilterColor() {
  if (!guideFilter) return;
  guideFilter.style.color = getGuideColorValue(selectedGuideId);
  guideFilter.style.fontWeight = "700";
}

function getAcceptedToursColorClass(tours) {
  const acceptedTours = (tours || []).filter((tour) => tour.status === "accepted");
  if (!acceptedTours.length) return "guide-color-1";
  const sortedAccepted = [...acceptedTours].sort(
    (left, right) => getGuideColorIndex(left.guide_id) - getGuideColorIndex(right.guide_id)
  );
  return getGuideColorClass(sortedAccepted[0].guide_id);
}

function getAcceptedToursTypeHint(tours) {
  const acceptedTours = (tours || []).filter((tour) => tour.status === "accepted");
  if (!acceptedTours.length) return "";
  const uniqueTypes = new Set(
    acceptedTours.map((tour) => String(tour.type || "").trim()).filter(Boolean)
  );
  return uniqueTypes.size === 1 ? Array.from(uniqueTypes)[0] : "";
}

function getVisibleToursForDate(iso) {
  const allTours = monthTours.filter((tour) => tour.date === iso);
  if (showAllTours) return allTours;
  return allTours.filter((tour) => tour.guide_id === selectedGuideId);
}

function getAvailableGuideIdsForDate(iso) {
  const unavailableGuideIds = monthUnavailableGuideIdsByDate.get(iso) || new Set();
  return new Set(Array.from(sharedGuideIds).filter((guideId) => !unavailableGuideIds.has(guideId)));
}

function findTourById(id) {
  return monthTours.find((tour) => tour.id === id) || null;
}

async function openTourModal(tour) {
  await tourModalController.openTourModal(tour);
}

function buildWeekdayRow() {
  clearChildren(weekdayRow);
  weekdayNames.forEach((name) => {
    const cell = document.createElement("div");
    cell.textContent = name;
    weekdayRow.appendChild(cell);
  });
}

function toggleAuthUI(isAuthed) {
  if (signInLink) signInLink.style.display = isAuthed ? "none" : "block";
  if (signUpLink) signUpLink.style.display = isAuthed ? "none" : "block";
}

function closeMenu() {
  if (!avatarDropdown || !avatarButton) return;
  avatarDropdown.classList.remove("open");
  avatarButton.setAttribute("aria-expanded", "false");
}

function toggleMenu() {
  if (!avatarDropdown || !avatarButton) return;
  const isOpen = avatarDropdown.classList.contains("open");
  avatarDropdown.classList.toggle("open", !isOpen);
  avatarButton.setAttribute("aria-expanded", String(!isOpen));
}

async function loadViewerColorPreferences() {
  viewerColorMode = "auto";
  viewerGuideColorOverrides = {};
  if (!session?.user?.id) return;
  const { data, error } = await supabase
    .from("guide_profiles")
    .select("color_mode,guide_color_overrides")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error || !data) return;
  viewerColorMode = data.color_mode === "custom" ? "custom" : "auto";
  viewerGuideColorOverrides = data.guide_color_overrides && typeof data.guide_color_overrides === "object"
    ? data.guide_color_overrides
    : {};
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
  if (!error && data) {
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
  }

  const { data: profiles, error: profileError } = await supabase
    .from("guide_profiles")
    .select("id,email,first_name,last_name")
    .in("id", Array.from(sharedGuideIds));
  if (!profileError && profiles) {
    profiles.forEach((profile) => sharedGuideProfiles.set(profile.id, profile));
  }

  if (!selectedGuideId || !sharedGuideIds.has(selectedGuideId)) {
    selectedGuideId = session.user.id;
  }
}

async function loadTourTypes() {
  tourTypes = [];
  if (!session || sharedGuideIds.size === 0) return;
  const { data, error } = await supabase
    .from("tour_types")
    .select("id,guide_id,name,shareable,payment_type,ticket_price,fee_per_participant,platforms")
    .order("name");
  if (!error && data) tourTypes = data;
}

async function loadTourTypeForTour(tour) {
  const { data } = await supabase
    .from("tour_types")
    .select("name,payment_type,ticket_price,commission_percent,fee_per_participant,invoice_org_name,invoice_org_address,platforms")
    .eq("guide_id", tour.guide_id)
    .eq("name", tour.type)
    .maybeSingle();
  if (data) return data;

  const { data: byName } = await supabase
    .from("tour_types")
    .select("guide_id,name,payment_type,ticket_price,commission_percent,fee_per_participant,invoice_org_name,invoice_org_address,platforms")
    .ilike("name", tour.type);
  if (!byName || byName.length === 0) return null;
  return byName.find((t) => t.guide_id === tour.guide_id)
    || byName.find((t) => t.guide_id === tour.created_by)
    || byName[0];
}

function buildGuideFilter() {
  if (!guideFilter) return;
  clearChildren(guideFilter);
  getOrderedGuideIds().forEach((id) => {
    const profile = sharedGuideProfiles.get(id);
    const option = document.createElement("option");
    option.value = id;
    option.textContent = profile ? `${profile.first_name} ${profile.last_name}` : id;
    option.style.color = getGuideColorValue(id);
    option.style.fontWeight = "700";
    if (id === selectedGuideId) option.selected = true;
    guideFilter.appendChild(option);
  });
  updateGuideFilterColor();
}

async function loadAvailabilityForSelectedGuide() {
  unavailableDates = new Set();
  if (!session || !selectedGuideId) return;
  monthUnavailableGuideIdsByDate.forEach((guideIds, date) => {
    if (guideIds.has(selectedGuideId)) unavailableDates.add(date);
  });
}

async function loadMonthTours() {
  monthTours = [];
  monthUnavailableGuideIdsByDate = new Map();
  if (!session) {
    renderCalendar();
    await renderSelectedDay();
    return;
  }

  await loadSharedGuides();
  await loadTourTypes();
  buildGuideFilter();

  const guideIds = Array.from(sharedGuideIds);
  const { start, end } = getMonthRange(viewYear, viewMonth);
  const [toursResponse, availabilityResponse] = await Promise.all([
    supabase
      .from("tours")
      .select("id,date,start_time,end_time,type,platform,is_private,invoice_path,free_amount_received,platform_due_amount,price_per_person,source_tour_type_id,participants(id,name,group_size,platform_name,attendance_status,paid_amount,booked_at),guide_id,created_by,status,participants_locked")
      .gte("date", start)
      .lte("date", end)
      .in("guide_id", guideIds)
      .order("date")
      .order("start_time"),
    supabase
      .from("guide_availability")
      .select("guide_id,date")
      .in("guide_id", guideIds)
      .gte("date", start)
      .lte("date", end)
      .eq("available", false),
  ]);

  const { data: toursData, error: toursError } = toursResponse;
  if (toursError) {
    renderCalendar();
    await renderSelectedDay();
    return;
  }

  if (availabilityResponse.data) {
    availabilityResponse.data.forEach((row) => {
      const setForDate = monthUnavailableGuideIdsByDate.get(row.date) || new Set();
      setForDate.add(row.guide_id);
      monthUnavailableGuideIdsByDate.set(row.date, setForDate);
    });
  }

  monthTours = toursData || [];
  await loadAvailabilityForSelectedGuide();
  renderCalendar();
  await renderSelectedDay();
  await tourModalController.syncOpenTour();
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
    const tours = getVisibleToursForDate(iso);
    cell.textContent = String(day);

    if (isPastDate) {
      cell.classList.add("past");
    } else if (unavailableDates.has(iso)) {
      cell.classList.add("unavailable");
    } else {
      cell.classList.add("available");
    }
    if (selectedDate === iso) cell.classList.add("selected");

    const participantsTotal = tours.reduce((sum, tour) => {
      return sum + (tour.participants || []).reduce((sub, participant) => sub + Number(participant.group_size || 0), 0);
    }, 0);
    if (participantsTotal > 0) {
      const participantsIndicator = document.createElement("div");
      participantsIndicator.className = "participants-indicator";
      participantsIndicator.textContent = String(participantsTotal);
      cell.appendChild(participantsIndicator);
    }

    if (tours.length) {
      const indicator = document.createElement("div");
      const hasPending = tours.some((tour) => tour.status === "pending");
      const acceptedColorClass = getAcceptedToursColorClass(tours);
      indicator.className = `tour-indicator ${hasPending ? "pending" : `accepted ${acceptedColorClass}`}`;
      if (!hasPending) {
        applyAcceptedTourStyle(indicator, {
          guideColorClass: acceptedColorClass,
          tourTypeName: getAcceptedToursTypeHint(tours),
          isPast: isPastDate,
        });
      }
      indicator.textContent = String(tours.length);
      cell.appendChild(indicator);
    }

    cell.addEventListener("click", async () => {
      selectedDate = iso;
      renderCalendar();
      await renderSelectedDay();
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

function renderTourItem(tour) {
  const profile = sharedGuideProfiles.get(tour.guide_id);
  const guideName = profile ? `${profile.first_name} ${profile.last_name}` : "Unknown";
  const isPrivate = isPrivateForViewer(tour);
  const tourIsPast = tour.date < getTodayISO();
  const row = document.createElement("button");
  const acceptedColorClass = tour.status === "accepted" ? ` ${getGuideColorClass(tour.guide_id)}` : "";
  const pastClass = tour.status === "pending" && tourIsPast ? " past" : "";
  row.className = `tour-row ${tour.status === "pending" ? "pending" : "accepted"}${acceptedColorClass}${pastClass}`;
  if (tour.status === "accepted") {
    applyAcceptedTourStyle(row, {
      guideColorClass: getGuideColorClass(tour.guide_id),
      tourTypeName: tour.type,
      isPast: tourIsPast,
    });
  }
  row.type = "button";
  row.addEventListener("click", () => openTourModal(tour));

  const text = document.createElement("div");
  text.textContent = `${(tour.start_time || "").slice(0, 5)} · ${guideName} · ${isPrivate ? "Private tour" : tour.type}`;
  row.appendChild(text);
  return row;
}

async function renderSelectedDay() {
  clearChildren(detailsContent);
  detailsContent.scrollTop = 0;

  if (!selectedDate) {
    detailsContent.textContent = "Pick a date to view tour times and notes.";
    return;
  }

  const title = document.createElement("div");
  title.className = "details-title";
  title.textContent = `Selected day · ${new Date(selectedDate).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
  detailsContent.appendChild(title);

  if (!session) return;

  const tours = getVisibleToursForDate(selectedDate);
  const isPastDate = selectedDate < getTodayISO();

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
    tours.forEach((tour) => listCard.appendChild(renderTourItem(tour)));
  }
  detailsContent.appendChild(listCard);

  if (isPastDate) return;

  const createCard = document.createElement("div");
  createCard.className = "card";
  const createTitle = document.createElement("div");
  createTitle.className = "details-title";
  createTitle.textContent = "Create Tour";
  createCard.appendChild(createTitle);

  const createForm = document.createElement("div");
  createForm.className = "form-row";

  const availableGuideIds = getAvailableGuideIdsForDate(selectedDate);
  const guideSelect = document.createElement("select");
  guideSelect.className = "select";
  getOrderedGuideIds().forEach((id) => {
    if (!availableGuideIds.has(id)) return;
    const profile = sharedGuideProfiles.get(id);
    const option = document.createElement("option");
    option.value = id;
    option.textContent = profile ? `${profile.first_name} ${profile.last_name}` : id;
    if (id === session.user.id) option.selected = true;
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
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "primary";
  addBtn.textContent = "Add tour";
  addBtn.disabled = !hasAvailableGuide;
  addBtn.addEventListener("click", async () => {
    if (!tourTypes.length) return alert("Please create a tour type first.");
    if (!hasAvailableGuide) return alert("No guide is available for this day.");
    if (!startInput.value) return alert("Please fill start time.");

    const selectedGuide = guideSelect.value || session.user.id;
    const selectedType = tourTypes.find((type) => type.id === typeSelect.value);
    if (!selectedType) return alert("Please select a tour type.");
    const selectedPlatform = getPlatformsForType(selectedType)[0] || null;
    if (!selectedPlatform) return alert("Please configure at least one platform for this tour type.");
    const pricePerPerson = getTourTypePricePerPerson(selectedType, selectedPlatform);

    const endValue = addMinutesToTime(startInput.value, 90);
    const needsValidation = selectedGuide === session.user.id
      ? false
      : shareValidationByGuideId.get(selectedGuide) !== false;
    const status = needsValidation ? "pending" : "accepted";

    const { data: conflicts } = await supabase
      .from("tours")
      .select("id")
      .eq("guide_id", selectedGuide)
      .eq("date", selectedDate)
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
      date: selectedDate,
      start_time: startInput.value,
      end_time: endValue,
      type: selectedType.name,
      is_private: selectedType.shareable === false,
      platform: selectedPlatform,
      price_per_person: pricePerPerson,
      source_tour_type_id: selectedType.id,
    });
    if (error) return;

    if (selectedGuide !== session.user.id) {
      await sendPush(supabase, {
        to_user_id: selectedGuide,
        title: needsValidation ? "New tour pending" : "New tour booked",
        body: needsValidation
          ? `A tour is waiting for your approval on ${selectedDate} at ${(startInput.value || "").slice(0, 5)}.`
          : `A new tour was booked for you on ${selectedDate} at ${(startInput.value || "").slice(0, 5)}.`,
        data: { url: "./index.html" },
      });
    }
    await loadMonthTours();
  });

  createForm.appendChild(startInput);
  createForm.appendChild(typeSelect);
  createForm.appendChild(guideSelect);
  createForm.appendChild(addBtn);
  createCard.appendChild(createForm);

  if (!hasAvailableGuide) {
    const note = document.createElement("div");
    note.className = "muted";
    note.textContent = "No available guide for this day. Update availability first.";
    createCard.appendChild(note);
  }

  detailsContent.appendChild(createCard);
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
  const lines = text.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const ignore = /reservas|buscar|gu[ií]a|selecciona|enviar|mensaje|difusi[oó]n|evento|confirmado|disponible/i;
  const participants = [];
  let pendingName = null;

  const extractGroupSize = (line) => {
    const matches = Array.from(line.matchAll(/(\d+)\s*(adult|adults|niñ|nino|niño|nina|niña)/gi));
    if (!matches.length) return 0;
    return matches.reduce((sum, match) => sum + Number(match[1]), 0);
  };

  const cleanName = (line) => {
    let name = line;
    name = name.replace(/^\W*\d+\s+/, "");
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
    if (!/\d/.test(line) && line.length >= 2) pendingName = line;
  }

  return participants;
}

async function extractParticipantsFromImage(file) {
  await loadTesseract();
  const { data } = await window.Tesseract.recognize(file, "spa+por+eng");
  return parseParticipantsFromText(data.text || "");
}

const tourModalController = createTourModalController({
  supabase,
  sendPush,
  modal: tourModal,
  modalBody,
  getSession: () => session,
  getSharedGuideIds: () => sharedGuideIds,
  getSharedGuideProfiles: () => sharedGuideProfiles,
  getShareValidationByGuideId: () => shareValidationByGuideId,
  getTourTypes: () => tourTypes,
  findTourById,
  loadTourTypeForTour,
  getPlatformsForType,
  extractParticipantsFromImage,
  getTodayISO,
  formatShortDateNoYear,
  isPrivateForViewer,
  money,
  reloadData: loadMonthTours,
  pageUrl: "./index.html",
});

function bindAuth() {
  avatarButton?.addEventListener("click", toggleMenu);
  modalClose?.addEventListener("click", () => tourModalController.closeTourModal());
  tourModal?.addEventListener("click", (event) => {
    if (event.target?.dataset?.close === "true") {
      tourModalController.closeTourModal();
    }
  });
  document.addEventListener("click", (event) => {
    if (!avatarDropdown || !avatarButton) return;
    if (avatarDropdown.contains(event.target) || avatarButton.contains(event.target)) return;
    closeMenu();
  });

  guideFilter?.addEventListener("change", async (event) => {
    selectedGuideId = event.target.value;
    await loadAvailabilityForSelectedGuide();
    updateGuideFilterColor();
    renderCalendar();
    await renderSelectedDay();
  });

  if (toursToggle) {
    toursToggle.checked = showAllTours;
    toursToggle.addEventListener("change", async () => {
      showAllTours = toursToggle.checked;
      renderCalendar();
      await renderSelectedDay();
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
  toggleAuthUI(true);
  await loadViewerColorPreferences();
  await ensurePushSubscription(supabase, session);
  await loadMonthTours();
}

prevMonthBtn?.addEventListener("click", async () => {
  viewMonth -= 1;
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear -= 1;
  }
  selectedDate = null;
  await loadMonthTours();
});

nextMonthBtn?.addEventListener("click", async () => {
  viewMonth += 1;
  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear += 1;
  }
  selectedDate = null;
  await loadMonthTours();
});

buildWeekdayRow();
bindAuth();
initAuth();
