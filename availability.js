import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription } from "./push.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthLabel = document.getElementById("monthLabel");
const calendarGrid = document.getElementById("calendarGrid");
const weekdayRow = document.getElementById("weekdayRow");
const prevMonthBtn = document.getElementById("prevMonth");
const nextMonthBtn = document.getElementById("nextMonth");
const signOutBtn = document.getElementById("signOutBtn");
const avatarButton = document.getElementById("avatarButton");
const avatarDropdown = document.getElementById("avatarDropdown");

const today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth();
let session = null;
let availableDates = new Set();

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

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toISO(year, month, day) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
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

function buildWeekdayRow() {
  clearChildren(weekdayRow);
  weekdayNames.forEach((name) => {
    const cell = document.createElement("div");
    cell.textContent = name;
    weekdayRow.appendChild(cell);
  });
}

async function loadAvailability() {
  if (!session) return;
  availableDates = new Set();

  const start = `${viewYear}-${pad2(viewMonth + 1)}-01`;
  const end = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(daysInMonth(viewYear, viewMonth))}`;

  const { data, error } = await supabase
    .from("guide_availability")
    .select("date")
    .eq("guide_id", session.user.id)
    .gte("date", start)
    .lte("date", end)
    .eq("available", true);

  if (error || !data) return;
  data.forEach((row) => availableDates.add(row.date));
}

function renderCalendar() {
  monthLabel.textContent = monthTitle(viewYear, viewMonth);
  clearChildren(calendarGrid);

  const totalDays = daysInMonth(viewYear, viewMonth);
  const offset = firstWeekdayMonday0(viewYear, viewMonth);
  const cells = [];

  for (let i = 0; i < offset; i += 1) cells.push(null);
  for (let day = 1; day <= totalDays; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayISO = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  })();

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
    cell.textContent = String(day);
    cell.setAttribute("aria-label", `${iso}`);

    if (isPastDate) {
      cell.classList.add("past");
    } else if (availableDates.has(iso)) {
      cell.classList.add("available");
    }

    cell.addEventListener("click", async () => {
      if (!session) return;
      if (isPastDate) return;
      if (availableDates.has(iso)) {
        const { error } = await supabase
          .from("guide_availability")
          .delete()
          .eq("guide_id", session.user.id)
          .eq("date", iso);
        if (!error) {
          availableDates.delete(iso);
          renderCalendar();
        }
      } else {
        const { error } = await supabase
          .from("guide_availability")
          .upsert({
            guide_id: session.user.id,
            date: iso,
            available: true,
          }, { onConflict: "guide_id,date" });
        if (!error) {
          availableDates.add(iso);
          renderCalendar();
        }
      }
    });

    calendarGrid.appendChild(cell);
  });
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
  await loadAvailability();
  renderCalendar();
}

prevMonthBtn.addEventListener("click", async () => {
  viewMonth -= 1;
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear -= 1;
  }
  await loadAvailability();
  renderCalendar();
});

nextMonthBtn.addEventListener("click", async () => {
  viewMonth += 1;
  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear += 1;
  }
  await loadAvailability();
  renderCalendar();
});

buildWeekdayRow();
init();

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
