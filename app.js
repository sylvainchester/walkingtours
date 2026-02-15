import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

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
let availabilityDates = new Set();
let selectedGuideId = null;
let onlyMyTours = true;
let modalOpenTourId = null;
let tourTypes = [];

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

async function loadSharedGuides() {
  sharedGuideIds = new Set();
  sharedGuideProfiles = new Map();
  if (!session) return;
  sharedGuideIds.add(session.user.id);

  const { data, error } = await supabase
    .from("guide_shares")
    .select("guide_id,shared_with_id")
    .or(`guide_id.eq.${session.user.id},shared_with_id.eq.${session.user.id}`);

  if (error || !data) return;

  data.forEach((row) => {
    if (row.guide_id) sharedGuideIds.add(row.guide_id);
    if (row.shared_with_id) sharedGuideIds.add(row.shared_with_id);
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
    .select("id,guide_id,name")
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

async function loadAvailabilityForSelectedGuide() {
  availabilityDates = new Set();
  if (!session || !selectedGuideId) return;
  const { start, end } = getMonthRange(viewYear, viewMonth);
  const { data } = await supabase
    .from("guide_availability")
    .select("date")
    .eq("guide_id", selectedGuideId)
    .gte("date", start)
    .lte("date", end)
    .eq("available", true);
  if (data) data.forEach((row) => availabilityDates.add(row.date));
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
    .select("id,date,start_time,end_time,type,participants(id,name,group_size),guide_id,created_by,status")
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
    } else if (availabilityDates.has(iso)) {
      cell.classList.add("available");
    } else {
      cell.classList.add("unavailable");
    }
    if (selectedDate === iso) cell.classList.add("selected");

    if (tours.length) {
      const indicator = document.createElement("div");
      const hasPending = tours.some((t) => t.status === "pending");
      indicator.className = `tour-indicator ${hasPending ? "pending" : "accepted"}`;
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
    option.value = type.name;
    option.textContent = type.name;
    if (value === type.name) option.selected = true;
    select.appendChild(option);
  });
  return select;
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

function openTourModal(tour) {
  if (!tourModal || !modalBody) return;
  modalOpenTourId = tour.id;
  tourModal.classList.add("open");
  tourModal.setAttribute("aria-hidden", "false");
  renderTourModal(tour);
}

function renderTourModal(tour) {
  clearChildren(modalBody);

  const profile = sharedGuideProfiles.get(tour.guide_id);
  const guideName = profile
    ? `${profile.first_name} ${profile.last_name}`
    : "Unknown";
  const isPast = tour.date < getTodayISO();

  const headerRow = document.createElement("div");
  headerRow.className = `tour-row ${tour.status === "pending" ? "pending" : "accepted"}`;
  headerRow.textContent = `${(tour.start_time || "").slice(0, 5)} - ${(tour.end_time || "").slice(0, 5)} · ${guideName} · ${tour.type}`;
  modalBody.appendChild(headerRow);

  const isOwner = session && tour.guide_id === session.user.id;
  const canEditParticipants = Boolean(session) && tour.status === "accepted" && !isPast;
  const canEditTour = Boolean(isOwner) && !isPast;

  if (canEditTour) {
    const timeRow = document.createElement("div");
    timeRow.className = "form-row";

    const startInput = document.createElement("input");
    startInput.type = "time";
    startInput.className = "input time-input";
    startInput.value = (tour.start_time || "").slice(0, 5);

    const endInput = document.createElement("input");
    endInput.type = "time";
    endInput.className = "input time-input";
    endInput.value = (tour.end_time || "").slice(0, 5);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "primary";
    saveBtn.textContent = "Save time";
    saveBtn.addEventListener("click", async () => {
      if (!startInput.value || !endInput.value) return;
      if (startInput.value >= endInput.value) return;
      const { error } = await supabase
        .from("tours")
        .update({ start_time: startInput.value, end_time: endInput.value })
        .eq("id", tour.id);
      if (!error) {
        await loadMonthTours();
      }
    });

    timeRow.appendChild(startInput);
    timeRow.appendChild(endInput);
    timeRow.appendChild(saveBtn);
    modalBody.appendChild(timeRow);
  }

  if (isOwner && !isPast) {
    const deleteRow = document.createElement("div");
    deleteRow.className = "form-row";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ghost";
    deleteBtn.textContent = "Delete tour";
    deleteBtn.addEventListener("click", async () => {
      if (!confirm("Delete this tour?")) return;
      const { error } = await supabase.from("tours").delete().eq("id", tour.id);
      if (!error) {
        closeTourModal();
        await loadMonthTours();
      }
    });
    deleteRow.appendChild(deleteBtn);
    modalBody.appendChild(deleteRow);
  }

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
        closeTourModal();
        await loadMonthTours();
      }
    });

    actions.appendChild(acceptBtn);
    actions.appendChild(declineBtn);
    modalBody.appendChild(actions);
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
      row.className = "participant";

      const name = document.createElement("div");
      name.textContent = `${p.name} (${p.group_size})`;
      row.appendChild(name);

      if (canEditParticipants) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ghost";
        remove.textContent = "Remove";
        remove.addEventListener("click", async () => {
          if (!confirm("Remove this participant?")) return;
          const { error } = await supabase.from("participants").delete().eq("id", p.id);
          if (!error) {
            await loadMonthTours();
          }
        });
        row.appendChild(remove);
      }

      list.appendChild(row);
    });
  }

  if (canEditParticipants) {
    const form = document.createElement("div");
    form.className = "form-row";

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
      if (!name) return;
      const { error } = await supabase.from("participants").insert({
        tour_id: tour.id,
        name,
        group_size: groupSize,
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
}

function renderTourItem(tour) {
  const profile = sharedGuideProfiles.get(tour.guide_id);
  const guideName = profile
    ? `${profile.first_name} ${profile.last_name}`
    : "Unknown";

  const tourIsPast = tour.date < getTodayISO();
  const row = document.createElement("button");
  row.className = `tour-row ${tour.status === "pending" ? "pending" : "accepted"}${tourIsPast ? " past" : ""}`;
  row.type = "button";
  row.addEventListener("click", () => openTourModal(tour));

  const time = (tour.start_time || "").slice(0, 5);
  const text = document.createElement("div");
  text.textContent = `${time} · ${guideName} · ${tour.type}`;

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
    const { data: availableRows } = await supabase
      .from("guide_availability")
      .select("guide_id")
      .in("guide_id", Array.from(sharedGuideIds))
      .eq("date", iso)
      .eq("available", true);
    if (availableRows) {
      availableGuideIds = new Set(availableRows.map((r) => r.guide_id));
    }
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

  const startInput = document.createElement("input");
  startInput.type = "time";
  startInput.className = "input time-input";

  const typeSelect = createTourTypeSelect(tourTypes[0]?.name);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "primary";
  addBtn.textContent = "Add tour";
  addBtn.addEventListener("click", async () => {
    if (!tourTypes.length) {
      alert("Please create a tour type first.");
      return;
    }
    if (!startInput.value) {
      alert("Please fill start time.");
      return;
    }
    const endValue = addMinutesToTime(startInput.value, 90);
    const selectedGuide = guideSelect.value || session.user.id;
    const status = selectedGuide === session.user.id ? "accepted" : "pending";
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
      type: typeSelect.value,
    });
    if (!error) {
      await loadMonthTours();
    }
  });

  createForm.appendChild(startInput);
  createForm.appendChild(typeSelect);
  createForm.appendChild(guideSelect);
  createForm.appendChild(addBtn);

  if (!isPastDate) {
    createCard.appendChild(createTitle);
    createCard.appendChild(createForm);
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
  await loadMonthTours();

  supabase.auth.onAuthStateChange((_event, newSession) => {
    session = newSession;
    toggleAuthUI(Boolean(session));
    if (!session) {
      window.location.href = "sign-in.html";
      return;
    }
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
