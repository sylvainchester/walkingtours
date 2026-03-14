import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription } from "./push.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const bookingImportsList = document.getElementById("bookingImportsList");
const confirmedBookingImportsList = document.getElementById("confirmedBookingImportsList");
const bookingImportStatus = document.getElementById("bookingImportStatus");
const checkNewEmailsBtn = document.getElementById("checkNewEmailsBtn");
const signOutBtn = document.getElementById("signOutBtn");
const avatarButton = document.getElementById("avatarButton");
const avatarDropdown = document.getElementById("avatarDropdown");
const shareLink = document.getElementById("shareLink");
const bookingImportModal = document.getElementById("bookingImportModal");
const bookingImportModalBody = document.getElementById("bookingImportModalBody");
const bookingImportModalClose = document.getElementById("bookingImportModalClose");

let session = null;
let sharedGuideIds = new Set();
let sharedGuideProfiles = new Map();
let toursById = new Map();
let recognizedImportEmails = new Set();
let recentKnownDrafts = [];

function isLocalHost() {
  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
}

function getApiBaseUrl() {
  return isLocalHost() ? "http://localhost:3000" : "https://walkingtours.vercel.app";
}

function setStatus(message) {
  if (bookingImportStatus) bookingImportStatus.textContent = message || "";
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isMissingImportEmailColumn(error) {
  return /import_email/i.test(String(error?.message || ""));
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function ordinal(day) {
  const value = Number(day);
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const mod10 = value % 10;
  if (mod10 === 1) return `${value}st`;
  if (mod10 === 2) return `${value}nd`;
  if (mod10 === 3) return `${value}rd`;
  return `${value}th`;
}

function formatShortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const day = ordinal(date.getUTCDate());
  const month = date.toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
  const year = date.getUTCFullYear();
  return `${day} of ${month} ${year}`;
}

function formatForwardedMeta(draft) {
  const sender = draft.from_email || "Unknown sender";
  const date = formatShortDate(draft.received_at || draft.created_at);
  return `Forwarded by ${sender} on the ${date}`;
}

function formatDetectedSchedule(draft) {
  const parsed = draft?.llm_extraction || {};
  const date = parsed?.date || null;
  const start = parsed?.start_time || null;
  const end = parsed?.end_time || null;
  if (!date && !start && !end) return "Unknown";
  const parts = [];
  if (date) parts.push(formatShortDate(date));
  if (start && end) parts.push(`${start} - ${end}`);
  else if (start) parts.push(start);
  return parts.join(" · ");
}

async function refreshDraftsAfterImportCheck() {
  await loadSharedGuides();
  await loadToursIndex();
  await loadDrafts({ preserveStatus: true });

  if (bookingImportsList?.textContent?.includes("No booking imports to review.")) {
    await sleep(1200);
    await loadSharedGuides();
    await loadToursIndex();
    await loadDrafts({ preserveStatus: true });
  }
}

function closeMenu() {
  avatarDropdown?.classList.remove("open");
  avatarButton?.setAttribute("aria-expanded", "false");
}

function closeBookingImportModal() {
  bookingImportModal?.classList.remove("open");
  bookingImportModal?.setAttribute("aria-hidden", "true");
  clearChildren(bookingImportModalBody);
}

function createEmailPanel(draft) {
  const right = document.createElement("div");
  right.className = "booking-import-panel";
  right.style.display = "none";

  if (draft.raw_html) {
    const previewFrame = document.createElement("iframe");
    previewFrame.className = "booking-import-preview";
    previewFrame.setAttribute("sandbox", "");
    previewFrame.srcdoc = draft.raw_html;
    right.appendChild(previewFrame);
  } else {
    const raw = document.createElement("pre");
    raw.className = "booking-import-raw";
    raw.textContent = draft.raw_text || "";
    right.appendChild(raw);
  }

  return right;
}

function createDraftCard(draft, options = {}) {
  const readOnly = Boolean(options.readOnly);
  const locked = Boolean(options.locked);
  const card = document.createElement("div");
  card.className = "details booking-import-card";

  const title = document.createElement("div");
  title.className = "details-title";
  title.textContent = draft.subject || "Imported email";
  card.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "muted";
  meta.textContent = formatForwardedMeta(draft);
  card.appendChild(meta);

  const detectedLine = document.createElement("div");
  detectedLine.className = "readme-line";
  detectedLine.textContent = `Tour detected in email: ${formatDetectedSchedule(draft)} · ${draft.llm_extraction?.tour_name || "Unknown"}`;
  card.appendChild(detectedLine);

  if (!draft.matched_tour_id) {
    const noMatchLine = document.createElement("div");
    noMatchLine.className = "readme-line";
    noMatchLine.style.color = "#b42318";
    noMatchLine.textContent = "No matched tour";
    card.appendChild(noMatchLine);
  }

  const left = document.createElement("div");
  left.className = "booking-import-panel";
  const leftTitle = document.createElement("div");
  leftTitle.className = "details-title";
  leftTitle.textContent = draft.matched_tour_id ? "Proposed import" : "Detected participants";
  left.appendChild(leftTitle);

  const leftPlatformLine = document.createElement("div");
  leftPlatformLine.className = "readme-line";
  leftPlatformLine.textContent = `Platform: ${draft.matched_platform_name || draft.llm_extraction?.platform_name || "Unknown"}`;
  left.appendChild(leftPlatformLine);

  const participants = Array.isArray(draft.imported_participants) ? draft.imported_participants : [];
  const participantsText = document.createElement("div");
  participantsText.className = "readme-line";
  participantsText.textContent = participants.length
    ? participants.map((participant) => `${participant.name} (${participant.group_size})`).join(" · ")
    : "No participants proposed.";
  left.appendChild(participantsText);

  card.appendChild(left);

  const toggleEmailBtn = document.createElement("button");
  toggleEmailBtn.type = "button";
  toggleEmailBtn.className = "ghost";
  toggleEmailBtn.textContent = "Show email";
  card.appendChild(toggleEmailBtn);

  const right = createEmailPanel(draft);
  toggleEmailBtn.addEventListener("click", () => {
    const shouldShow = right.style.display === "none";
    right.style.display = shouldShow ? "grid" : "none";
    toggleEmailBtn.textContent = shouldShow ? "Hide email" : "Show email";
  });
  card.appendChild(right);

  if (draft.error_message) {
    const errorLine = document.createElement("div");
    errorLine.className = "muted";
    errorLine.textContent = draft.error_message;
    card.appendChild(errorLine);
  }

  if (locked) {
    const lockedLine = document.createElement("div");
    lockedLine.className = "muted";
    lockedLine.textContent = draft.locked_message || "Already stored in database. Confirm import disabled.";
    card.appendChild(lockedLine);
  }

  const actions = document.createElement("div");
  actions.className = "form-row";

  if (readOnly) {
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "ghost";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", closeBookingImportModal);
    actions.appendChild(closeBtn);
  } else {
    if (draft.matched_tour_id) {
      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "primary";
      confirmBtn.textContent = "Confirm import";
      confirmBtn.disabled = locked || participants.length === 0;
      confirmBtn.addEventListener("click", async () => {
        const ok = await reviewDraft(draft.id, "confirm");
        if (ok) {
          setStatus("Import confirmed.");
          await loadDrafts();
        }
      });
      actions.appendChild(confirmBtn);
    }

    if (!locked) {
      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "ghost danger";
      rejectBtn.textContent = draft.matched_tour_id ? "Reject import" : "Reject email";
      rejectBtn.addEventListener("click", async () => {
        const ok = await reviewDraft(draft.id, "reject");
        if (ok) {
          setStatus("Import rejected.");
          await loadDrafts();
        }
      });
      actions.appendChild(rejectBtn);
    }
  }

  card.appendChild(actions);
  return card;
}

function openBookingImportModal(draft) {
  if (!bookingImportModal || !bookingImportModalBody) return;
  clearChildren(bookingImportModalBody);
  bookingImportModalBody.appendChild(createDraftCard(draft, { readOnly: true }));
  bookingImportModal.classList.add("open");
  bookingImportModal.setAttribute("aria-hidden", "false");
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
  sharedGuideIds = new Set([session.user.id]);
  sharedGuideProfiles = new Map();
  recognizedImportEmails = new Set([normalizeEmail(session.user.email)]);

  const { data: shareRows } = await supabase
    .from("guide_shares")
    .select("guide_id,shared_with_id")
    .or(`guide_id.eq.${session.user.id},shared_with_id.eq.${session.user.id}`);

  (shareRows || []).forEach((row) => {
    if (row.guide_id) sharedGuideIds.add(row.guide_id);
    if (row.shared_with_id) sharedGuideIds.add(row.shared_with_id);
  });

  let { data: profiles, error: profilesError } = await supabase
    .from("guide_profiles")
    .select("id,first_name,last_name,email,import_email,import_email_2")
    .in("id", Array.from(sharedGuideIds));
  if (profilesError && isMissingImportEmailColumn(profilesError)) {
    ({ data: profiles } = await supabase
      .from("guide_profiles")
      .select("id,first_name,last_name,email,import_email")
      .in("id", Array.from(sharedGuideIds)));
    profiles = (profiles || []).map((profile) => ({ ...profile, import_email_2: null }));
  }
  if (profilesError && isMissingImportEmailColumn(profilesError)) {
    ({ data: profiles } = await supabase
      .from("guide_profiles")
      .select("id,first_name,last_name,email")
      .in("id", Array.from(sharedGuideIds)));
    profiles = (profiles || []).map((profile) => ({
      ...profile,
      import_email: null,
      import_email_2: null,
    }));
  }
  (profiles || []).forEach((profile) => {
    sharedGuideProfiles.set(profile.id, profile);
    if (profile.id === session.user.id) {
      if (normalizeEmail(profile.email)) recognizedImportEmails.add(normalizeEmail(profile.email));
      if (normalizeEmail(profile.import_email)) recognizedImportEmails.add(normalizeEmail(profile.import_email));
      if (normalizeEmail(profile.import_email_2)) recognizedImportEmails.add(normalizeEmail(profile.import_email_2));
    }
  });
}

async function loadToursIndex() {
  const { data } = await supabase
    .from("tours")
    .select("id,date,start_time,end_time,type,guide_id")
    .in("guide_id", Array.from(sharedGuideIds));
  toursById = new Map((data || []).map((tour) => [tour.id, tour]));
}

function formatTourLabel(tour) {
  if (!tour) return "No matched tour";
  const profile = sharedGuideProfiles.get(tour.guide_id);
  const guideName = profile
    ? `${profile.first_name} ${profile.last_name}`
    : "Unknown";
  return `${tour.date} · ${(tour.start_time || "").slice(0, 5)} · ${guideName} · ${tour.type}`;
}

async function reviewDraft(draftId, action) {
  const apiUrl = isLocalHost()
    ? `${getApiBaseUrl()}/api/review-booking-import`
    : "/api/review-booking-import";
  const { data: authData } = await supabase.auth.getSession();
  const accessToken = authData?.session?.access_token;
  if (!accessToken) {
    setStatus("Auth session missing.");
    return false;
  }

  setStatus(action === "reject" ? "Rejecting import..." : "Confirming import...");

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        draft_id: draftId,
        action,
      }),
    });
    const contentType = response.headers.get("content-type") || "";
    const result = contentType.includes("application/json")
      ? await response.json()
      : { ok: false, error: await response.text() };
    if (!response.ok || !result?.ok) {
      setStatus(result?.error || "Review action failed.");
      return false;
    }
    return true;
  } catch (error) {
    console.error("review draft error", error);
    setStatus(error?.message || "Review action failed.");
    return false;
  }
}

async function checkNewEmails() {
  const apiUrl = `${getApiBaseUrl()}/api/poll-bookings?token=danslecullabalayettelemancheetletiquette&use_llm=1&_ts=${Date.now()}`;

  checkNewEmailsBtn.disabled = true;
  setStatus("Checking new emails...");

  try {
    const { data: authData } = await supabase.auth.getSession();
    const accessToken = authData?.session?.access_token;
    if (!accessToken) {
      throw new Error("Auth session missing.");
    }
    const response = await fetch(apiUrl, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const result = await response.json();
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || "Check new emails failed.");
    }
    recentKnownDrafts = (result.details || [])
      .filter((detail) => detail.status === "already_known" && detail.existing_draft)
      .map((detail) => ({
        ...detail.existing_draft,
        locked_message: `Already in database with status: ${detail.existing_status || detail.existing_draft.status || "unknown"}.`,
      }));
    const alreadyKnownCount = recentKnownDrafts.length;
    setStatus(
      `Email check finished. Checked ${result.checked || 0}, new ${result.imported || 0}, ignored ${result.ignored || 0}, already known ${alreadyKnownCount}. Reloading imports...`
    );
    await refreshDraftsAfterImportCheck();
  } catch (error) {
    console.error("check new emails error", error);
    setStatus(error?.message || "Check new emails failed.");
  } finally {
    checkNewEmailsBtn.disabled = false;
  }
}

async function loadDrafts(options = {}) {
  const preserveStatus = Boolean(options.preserveStatus);
  clearChildren(bookingImportsList);
  clearChildren(confirmedBookingImportsList);
  if (!preserveStatus) setStatus("");

  const { data, error } = await supabase
    .from("incoming_booking_emails")
    .select("id,subject,from_email,received_at,raw_text,raw_html,matched_tour_id,matched_platform_name,imported_participants,llm_extraction,status,error_message,created_at")
    .in("status", ["pending_review", "error", "ignored", "confirmed", "rejected"])
    .order("created_at", { ascending: false });

  if (error) {
    setStatus(`Load error: ${error.message}`);
    return;
  }

  const visibleRows = (data || []).filter((draft) => {
    if (!recognizedImportEmails.has(normalizeEmail(draft.from_email))) return false;
    if (!draft.matched_tour_id) return true;
    const tour = toursById.get(draft.matched_tour_id);
    if (!tour) return true;
    return sharedGuideIds.has(tour.guide_id);
  });
  const lockedIds = new Set(recentKnownDrafts.map((draft) => draft.id).filter(Boolean));
  const visibleKnownDrafts = recentKnownDrafts.filter((draft) => {
    if (!recognizedImportEmails.has(normalizeEmail(draft.from_email))) return false;
    if (!draft.matched_tour_id) return true;
    const tour = toursById.get(draft.matched_tour_id);
    if (!tour) return true;
    return sharedGuideIds.has(tour.guide_id);
  });
  const drafts = visibleRows.filter((draft) => !["confirmed", "rejected"].includes(draft.status));
  const historyRows = visibleRows.filter((draft) => ["confirmed", "rejected"].includes(draft.status) && !lockedIds.has(draft.id));

  if (!drafts.length && !visibleKnownDrafts.length) {
    const empty = document.createElement("div");
    empty.textContent = "No booking imports to review.";
    bookingImportsList.appendChild(empty);
  }

  visibleKnownDrafts.forEach((draft) => {
    bookingImportsList.appendChild(createDraftCard(draft, { locked: true }));
  });

  drafts.forEach((draft) => {
    bookingImportsList.appendChild(createDraftCard(draft));
  });

  if (!historyRows.length) {
    const emptyConfirmed = document.createElement("div");
    emptyConfirmed.textContent = "No import history yet.";
    confirmedBookingImportsList.appendChild(emptyConfirmed);
    return;
  }

  historyRows.forEach((draft) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `booking-import-confirmed ${draft.status === "rejected" ? "rejected" : "confirmed"}`;
    row.addEventListener("click", () => openBookingImportModal(draft));

    const matchedTour = toursById.get(draft.matched_tour_id);
    const participants = Array.isArray(draft.imported_participants) ? draft.imported_participants : [];
    const participantsCount = participants.reduce(
      (sum, participant) => sum + Number(participant.group_size || 0),
      0
    );

    const line1 = document.createElement("div");
    line1.textContent = `${formatShortDate(draft.received_at || draft.created_at)} · ${draft.subject || "Imported email"}`;
    row.appendChild(line1);

    const line2 = document.createElement("div");
    line2.className = "muted";
    line2.textContent = `${draft.status === "rejected" ? "Rejected" : "Confirmed"} · ${formatTourLabel(matchedTour)} · ${draft.matched_platform_name || draft.llm_extraction?.platform_name || "Unknown"} · ${participantsCount} participants`;
    row.appendChild(line2);

    if (draft.status === "rejected" && draft.error_message) {
      const line3 = document.createElement("div");
      line3.className = "muted";
      line3.textContent = draft.error_message;
      row.appendChild(line3);
    }

    confirmedBookingImportsList.appendChild(row);
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
  await loadSharedGuides();
    await loadToursIndex();
    await loadDrafts({ preserveStatus: true });
}

signOutBtn?.addEventListener("click", async () => {
  await supabase.auth.signOut();
  closeMenu();
  window.location.href = "sign-in.html";
});

avatarButton?.addEventListener("click", () => {
  const isOpen = avatarDropdown.classList.contains("open");
  avatarDropdown.classList.toggle("open", !isOpen);
  avatarButton.setAttribute("aria-expanded", String(!isOpen));
});

document.addEventListener("click", (event) => {
  if (!avatarDropdown || !avatarButton) return;
  if (avatarDropdown.contains(event.target) || avatarButton.contains(event.target)) return;
  closeMenu();
});

bookingImportModalClose?.addEventListener("click", closeBookingImportModal);
bookingImportModal?.addEventListener("click", (event) => {
  if (event.target?.dataset?.close === "true") closeBookingImportModal();
});

checkNewEmailsBtn?.addEventListener("click", checkNewEmails);

init();
