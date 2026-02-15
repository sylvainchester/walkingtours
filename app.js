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
const enablePushBtn = document.getElementById("enablePushBtn");
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
let html2pdfLoader = null;
let ocrBusy = false;

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
    .select("name,payment_type,ticket_price,commission_percent,fee_per_participant,invoice_org_name")
    .eq("guide_id", tour.guide_id)
    .eq("name", tour.type)
    .maybeSingle();
  return data || null;
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
    .select("id,guide_id,name,shareable")
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
    .select("id,date,start_time,end_time,type,is_private,invoice_path,participants(id,name,group_size,attendance_status),guide_id,created_by,status,participants_locked")
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
    option.value = type.id;
    option.textContent = type.name;
    if (value === type.id) option.selected = true;
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
  const unresolvedParticipants = (tour.participants || []).filter(
    (p) => p.attendance_status !== "arrived" && p.attendance_status !== "absent"
  );
  const canLockParticipants = Boolean(session)
    && tour.status === "accepted"
    && !isPast
    && !isLocked
    && !isPrivate
    && unresolvedParticipants.length === 0
    && (isOwner || isCreator);

  if (canDeleteTour) {
    const deleteRow = document.createElement("div");
    deleteRow.className = "form-row";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ghost";
    deleteBtn.textContent = "Delete tour";
    deleteBtn.addEventListener("click", async () => {
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
      name.textContent = `${p.name} (${p.group_size})`;
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

        actions.appendChild(arrivedBtn);
        actions.appendChild(absentBtn);
        row.appendChild(actions);
      }

      list.appendChild(row);
    });
  }

  if (canEditParticipants) {
    const importRow = document.createElement("div");
    importRow.className = "form-row";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "ghost";
    importBtn.textContent = ocrBusy ? "Importing..." : "Import participants";
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
          if (confirm(`Import ${participants.length} participants?`)) {
            const { error } = await supabase.from("participants").insert(
              participants.map((p) => ({
                tour_id: tour.id,
                name: p.name,
                group_size: p.group_size,
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
        importBtn.textContent = "Import participants";
        importBtn.disabled = false;
        fileInput.value = "";
      }
    });

    importRow.appendChild(importBtn);
    importRow.appendChild(importStatus);
    list.appendChild(importRow);
    list.appendChild(fileInput);

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

  if (canManageLock && !isLocked) {
    const lockRow = document.createElement("div");
    lockRow.className = "form-row";
    const lockBtn = document.createElement("button");
    lockBtn.type = "button";
    lockBtn.className = "ghost danger";
    lockBtn.textContent = "Lock participants";
    lockBtn.disabled = !canLockParticipants;
    lockBtn.addEventListener("click", async () => {
      if (!canLockParticipants) return;
      if (!confirm("Lock participants permanently? This cannot be undone.")) return;
      let filePath = null;
      try {
        const { blob, invoiceNo } = await generateInvoicePdf(tour);
        filePath = `${tour.guide_id}/${tour.date}/${tour.id}/${invoiceNo}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("invoices")
          .upload(filePath, blob, {
            contentType: "application/pdf",
            upsert: true,
          });
        if (uploadError) {
          alert(`Invoice upload error: ${uploadError.message}`);
          return;
        }
      } catch (invoiceError) {
        alert(`Invoice generation error: ${invoiceError.message || invoiceError}`);
        return;
      }
      const { error } = await supabase
        .from("tours")
        .update({ participants_locked: true, invoice_path: filePath })
        .eq("id", tour.id);
      if (!error) {
        await loadMonthTours();
      }
    });
    lockRow.appendChild(lockBtn);
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
      }
      lockRow.appendChild(reason);
    }
    modalBody.appendChild(lockRow);
  } else if (isLocked) {
    const lockedNote = document.createElement("div");
    lockedNote.className = "muted";
    lockedNote.textContent = "Participants are locked.";
    modalBody.appendChild(lockedNote);
  } else if (tour.status !== "accepted") {
    const pendingNote = document.createElement("div");
    pendingNote.className = "muted";
    pendingNote.textContent = "Lock is available only after tour acceptance.";
    modalBody.appendChild(pendingNote);
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
  row.className = `tour-row ${tour.status === "pending" ? "pending" : "accepted"}${tourIsPast ? " past" : ""}`;
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

  const typeSelect = createTourTypeSelect(tourTypes[0]?.id);

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
    const selectedType = tourTypes.find((type) => type.id === typeSelect.value);
    if (!selectedType) {
      alert("Please select a tour type.");
      return;
    }
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
      type: selectedType.name,
      is_private: selectedType.shareable === false,
    });
    if (!error) {
      if (selectedGuide !== session.user.id) {
        await sendPush(supabase, {
          to_user_id: selectedGuide,
          title: "New tour pending",
          body: `A tour is waiting for your approval on ${iso} at ${(startInput.value || "").slice(0, 5)}.`,
          data: { url: "./index.html" },
        });
      }
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
  if (enablePushBtn) {
    enablePushBtn.addEventListener("click", async () => {
      if (!session) return;
      await ensurePushSubscription(supabase, session);
      closeMenu();
      alert("Notifications enabled (if allowed by your browser).");
    });
  }
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
  await loadMonthTours();

  supabase.auth.onAuthStateChange((_event, newSession) => {
    session = newSession;
    toggleAuthUI(Boolean(session));
    if (!session) {
      window.location.href = "sign-in.html";
      return;
    }
    ensurePushSubscription(supabase, session);
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
