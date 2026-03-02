import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription, sendPush } from "./push.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const summaryList = document.getElementById("summaryList");
const bulkGuideSelect = document.getElementById("bulkGuideSelect");
const bulkSaveBtn = document.getElementById("bulkSaveBtn");
const bulkStatus = document.getElementById("bulkStatus");
const avatarButton = document.getElementById("avatarButton");
const avatarDropdown = document.getElementById("avatarDropdown");
const shareLink = document.getElementById("shareLink");
const availabilityLink = document.getElementById("availabilityLink");
const signOutBtn = document.getElementById("signOutBtn");
const tourModal = document.getElementById("tourModal");
const modalBody = document.getElementById("modalBody");
const modalClose = document.getElementById("modalClose");

const GUIDE_COLOR_CLASSES = [
  "guide-color-1",
  "guide-color-2",
  "guide-color-3",
  "guide-color-4",
  "guide-color-5",
];

let session = null;
let tours = [];
let sharedGuideIds = new Set();
let sharedGuideProfiles = new Map();
let shareValidationByGuideId = new Map();
let tourTypes = [];
let selectedTourIds = new Set();
let modalOpenTourId = null;
let ocrBusy = false;

function setStatus(message) {
  if (bulkStatus) bulkStatus.textContent = message || "";
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseISO(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
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
  const orderedIds = getOrderedGuideIds();
  const index = orderedIds.indexOf(guideId);
  if (index === -1) return 0;
  return Math.min(index, GUIDE_COLOR_CLASSES.length - 1);
}

function getGuideColorClass(guideId) {
  return GUIDE_COLOR_CLASSES[getGuideColorIndex(guideId)] || GUIDE_COLOR_CLASSES[0];
}

function getGuideColorValue(guideId) {
  const colorClass = getGuideColorClass(guideId);
  const colorMap = {
    "guide-color-1": "#1e6f3a",
    "guide-color-2": "#1f4f8f",
    "guide-color-3": "#c04a8b",
    "guide-color-4": "#6f42b5",
    "guide-color-5": "#7a4a21",
  };
  return colorMap[colorClass] || colorMap["guide-color-1"];
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

function isPrivateForViewer(tour) {
  return Boolean(tour?.is_private) && tour?.guide_id !== session?.user?.id;
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
  shareLink?.classList.toggle("has-pending-dot", hasPending);
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

async function loadTours() {
  if (!session) return;
  const guideIds = Array.from(sharedGuideIds);
  const { data, error } = await supabase
    .from("tours")
    .select("id,date,start_time,end_time,type,platform,is_private,invoice_path,free_amount_received,platform_due_amount,participants(id,name,group_size,platform_name,attendance_status),guide_id,created_by,status,participants_locked")
    .in("guide_id", guideIds)
    .gte("date", getTodayISO())
    .order("date")
    .order("start_time");
  if (error) {
    setStatus(`Load error: ${error.message}`);
    return;
  }
  tours = data || [];
  renderSummaryList();
  if (modalOpenTourId) {
    const tour = findTourById(modalOpenTourId);
    if (tour) openTourModal(tour);
    else closeTourModal();
  }
}

function renderBulkGuideSelect() {
  if (!bulkGuideSelect) return;
  clearChildren(bulkGuideSelect);
  getOrderedGuideIds().forEach((guideId) => {
    const profile = sharedGuideProfiles.get(guideId);
    const option = document.createElement("option");
    option.value = guideId;
    option.textContent = profile
      ? `${profile.first_name} ${profile.last_name}`
      : guideId;
    option.className = getGuideColorClass(guideId);
    option.style.color = getGuideColorValue(guideId);
    option.style.fontWeight = "700";
    bulkGuideSelect.appendChild(option);
  });
  bulkGuideSelect.style.color = getGuideColorValue(bulkGuideSelect.value);
  bulkGuideSelect.style.fontWeight = "700";
}

function renderSummaryList() {
  if (!summaryList) return;
  clearChildren(summaryList);
  if (!tours.length) {
    const empty = document.createElement("div");
    empty.textContent = "No tours found.";
    summaryList.appendChild(empty);
    return;
  }

  tours.forEach((tour) => {
    const wrapper = document.createElement("div");
    wrapper.className = "summary-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "summary-check";
    checkbox.checked = selectedTourIds.has(tour.id);
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedTourIds.add(tour.id);
      else selectedTourIds.delete(tour.id);
    });
    wrapper.appendChild(checkbox);

    const row = document.createElement("button");
    row.type = "button";
    const profile = sharedGuideProfiles.get(tour.guide_id);
    const guideName = profile
      ? `${profile.first_name} ${profile.last_name}`
      : "Unknown";
    const isPrivate = isPrivateForViewer(tour);
    const tourIsPast = tour.date < getTodayISO();
    const acceptedColorClass = tour.status === "accepted" ? ` ${getGuideColorClass(tour.guide_id)}` : "";
    row.className = `tour-row summary-row-main ${tour.status === "pending" ? "pending" : "accepted"}${acceptedColorClass}${tourIsPast ? " past" : ""}`;
    row.addEventListener("click", () => openTourModal(tour));

    const text = document.createElement("div");
    text.textContent = `${formatShortDateNoYear(tour.date)} · ${(tour.start_time || "").slice(0, 5)} · ${guideName} · ${isPrivate ? "Private tour" : tour.type}`;
    row.appendChild(text);

    wrapper.appendChild(row);
    summaryList.appendChild(wrapper);
  });
}

function getPlatformsForType(type) {
  if (!type) return [];
  return Array.isArray(type.platforms) ? type.platforms : [];
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

function findTourById(id) {
  return tours.find((tour) => tour.id === id) || null;
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
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

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
    if (!/\d/.test(line) && line.length >= 2) {
      pendingName = line;
    }
  }

  return participants;
}

async function extractParticipantsFromImage(file) {
  await loadTesseract();
  const { data } = await window.Tesseract.recognize(file, "spa+por+eng");
  return parseParticipantsFromText(data.text || "");
}

async function saveTourGuideChange(tour, nextGuideId, currentGuideName) {
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
  if (conflictError) throw new Error(`Conflict check error: ${conflictError.message}`);
  if (conflicts && conflicts.length > 0) throw new Error("This guide already has another tour at the same time.");

  const previousGuideId = tour.guide_id;
  const nextGuideProfile = sharedGuideProfiles.get(nextGuideId);
  const nextGuideName = nextGuideProfile
    ? `${nextGuideProfile.first_name} ${nextGuideProfile.last_name}`
    : "Unknown";

  const { error } = await supabase
    .from("tours")
    .update({ guide_id: nextGuideId, status: nextStatus })
    .eq("id", tour.id);
  if (error) throw new Error(`Guide update error: ${error.message}`);

  if (previousGuideId !== session.user.id) {
    await sendPush(supabase, {
      to_user_id: previousGuideId,
      title: "Tour reassigned",
      body: `A tour on ${tour.date} is no longer assigned to you.`,
      data: { url: "./summary-list.html" },
    });
  }
  if (nextGuideId !== session.user.id) {
    await sendPush(supabase, {
      to_user_id: nextGuideId,
      title: nextStatus === "pending" ? "Tour reassignment pending" : "Tour reassigned",
      body: nextStatus === "pending"
        ? `${currentGuideName} reassigned a tour to you on ${tour.date}.`
        : `${currentGuideName} reassigned a tour to ${nextGuideName === currentGuideName ? "you" : nextGuideName} on ${tour.date}.`,
      data: { url: "./summary-list.html" },
    });
  }
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
  headerRow.textContent = `${formatShortDateNoYear(tour.date)} · ${(tour.start_time || "").slice(0, 5)} - ${(tour.end_time || "").slice(0, 5)} · ${guideName} · ${isPrivate ? "Private tour" : tour.type}`;
  modalBody.appendChild(headerRow);

  const isOwner = session && tour.guide_id === session.user.id;
  const isCreator = session && tour.created_by === session.user.id;
  const canManageLock = Boolean(session) && (isOwner || isCreator);
  const isLocked = Boolean(tour.participants_locked);
  const canEditParticipants = Boolean(session) && tour.status === "accepted" && !isPast && !isLocked && !isPrivate;
  const canDeleteTour = Boolean(session) && !isPast && (isOwner || isCreator);
  const canEditTourGuide = Boolean(session) && !isPast && !isLocked && !isPrivate && (isOwner || isCreator);
  const typeForTour = tourTypes.find((type) => type.guide_id === tour.guide_id && type.name === tour.type)
    || await loadTourTypeForTour(tour)
    || null;
  const platformForTour = tour.platform || getPlatformsForType(typeForTour)[0] || null;
  const participantPlatforms = getPlatformsForType(typeForTour);
  const isFreeTour = typeForTour?.payment_type === "free" || /free/i.test(String(tour.type || ""));
  const feePerParticipant = Number(platformForTour?.commission_percent || typeForTour?.fee_per_participant || 0);
  const unresolvedParticipants = (tour.participants || []).filter(
    (participant) => participant.attendance_status !== "arrived" && participant.attendance_status !== "absent"
  );
  const arrivedParticipants = (tour.participants || []).filter(
    (participant) => participant.attendance_status === "arrived"
  );
  const arrivedPersonsCount = arrivedParticipants.reduce(
    (sum, participant) => sum + Number(participant.group_size || 0),
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
      try {
        await saveTourGuideChange(tour, nextGuideId, guideName);
        await loadTours();
      } catch (error) {
        alert(error.message);
      }
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
        data: { url: "./summary-list.html" },
      });
    }
    closeTourModal();
    await loadTours();
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
            data: { url: "./summary-list.html" },
          });
        }
        await loadTours();
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
            data: { url: "./summary-list.html" },
          });
        }
        closeTourModal();
        await loadTours();
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
    tour.participants.forEach((participant) => {
      const row = document.createElement("div");
      row.className = `participant${participant.attendance_status ? ` ${participant.attendance_status}` : ""}`;

      const name = document.createElement("div");
      name.textContent = `${participant.name} (${participant.group_size})${participant.platform_name ? ` · ${participant.platform_name}` : ""}`;
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
            .eq("id", participant.id);
          if (!error) await loadTours();
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
            .eq("id", participant.id);
          if (!error) await loadTours();
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
            .eq("id", participant.id);
          if (!error) await loadTours();
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
              participants.map((participant) => ({
                tour_id: tour.id,
                name: participant.name,
                group_size: participant.group_size,
                platform_name: platformName,
              }))
            );
            if (!error) {
              await loadTours();
            }
          }
        }
      } catch {
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
        await loadTours();
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
        await loadTours();
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
        await loadTours();
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

async function handleBulkSave() {
  const nextGuideId = bulkGuideSelect.value;
  if (!nextGuideId) {
    setStatus("Select a guide.");
    return;
  }
  if (selectedTourIds.size === 0) {
    setStatus("Select at least one tour.");
    return;
  }

  let updated = 0;
  let skipped = 0;
  const messages = [];

  for (const tourId of Array.from(selectedTourIds)) {
    const tour = findTourById(tourId);
    if (!tour) {
      skipped += 1;
      messages.push(`${tourId}: tour not found`);
      continue;
    }
    const isPast = tour.date < getTodayISO();
    const isPrivate = isPrivateForViewer(tour);
    const isLocked = Boolean(tour.participants_locked);
    const isOwner = tour.guide_id === session.user.id;
    const isCreator = tour.created_by === session.user.id;
    const canEditTourGuide = !isPast && !isLocked && !isPrivate && (isOwner || isCreator);
    let skipReason = "";
    if (tour.guide_id === nextGuideId) {
      skipReason = "already assigned to this guide";
    } else if (isPast) {
      skipReason = "past tour";
    } else if (isLocked) {
      skipReason = "participants locked";
    } else if (isPrivate) {
      skipReason = "private tour";
    } else if (!canEditTourGuide) {
      skipReason = "you cannot edit this tour";
    }
    if (skipReason) {
      skipped += 1;
      messages.push(`${formatShortDateNoYear(tour.date)} ${(tour.start_time || "").slice(0, 5)}: ${skipReason}`);
      continue;
    }
    try {
      const currentGuideProfile = sharedGuideProfiles.get(tour.guide_id);
      const currentGuideName = currentGuideProfile
        ? `${currentGuideProfile.first_name} ${currentGuideProfile.last_name}`
        : "Unknown";
      await saveTourGuideChange(tour, nextGuideId, currentGuideName);
      updated += 1;
      selectedTourIds.delete(tour.id);
    } catch (error) {
      skipped += 1;
      messages.push(`${formatShortDateNoYear(tour.date)} ${(tour.start_time || "").slice(0, 5)}: ${error.message}`);
    }
  }

  await loadTours();
  const summary = `Updated ${updated} tour${updated === 1 ? "" : "s"}. Skipped ${skipped}.`;
  setStatus(messages.length ? `${summary} ${messages.join(" | ")}` : summary);
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
  await loadTourTypes();
  renderBulkGuideSelect();
  await loadTours();
}

signOutBtn?.addEventListener("click", async () => {
  await supabase.auth.signOut();
  closeMenu();
  window.location.href = "sign-in.html";
});

avatarButton?.addEventListener("click", toggleMenu);
document.addEventListener("click", (event) => {
  if (!avatarDropdown || !avatarButton) return;
  if (avatarDropdown.contains(event.target) || avatarButton.contains(event.target)) return;
  closeMenu();
});
modalClose?.addEventListener("click", closeTourModal);
tourModal?.addEventListener("click", (event) => {
  if (event.target && event.target.dataset && event.target.dataset.close === "true") {
    closeTourModal();
  }
});
bulkSaveBtn?.addEventListener("click", handleBulkSave);
bulkGuideSelect?.addEventListener("change", () => {
  bulkGuideSelect.style.color = getGuideColorValue(bulkGuideSelect.value);
  bulkGuideSelect.style.fontWeight = "700";
});

init();
