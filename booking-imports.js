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

let session = null;
let sharedGuideIds = new Set();
let sharedGuideProfiles = new Map();
let toursById = new Map();

function setStatus(message) {
  if (bookingImportStatus) bookingImportStatus.textContent = message || "";
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
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

async function refreshDraftsAfterImportCheck() {
  await loadToursIndex();
  await loadDrafts({ preserveStatus: true });

  if (bookingImportsList?.textContent?.includes("No booking imports to review.")) {
    await sleep(1200);
    await loadToursIndex();
    await loadDrafts({ preserveStatus: true });
  }
}

function closeMenu() {
  avatarDropdown?.classList.remove("open");
  avatarButton?.setAttribute("aria-expanded", "false");
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

  const { data: shareRows } = await supabase
    .from("guide_shares")
    .select("guide_id,shared_with_id")
    .or(`guide_id.eq.${session.user.id},shared_with_id.eq.${session.user.id}`);

  (shareRows || []).forEach((row) => {
    if (row.guide_id) sharedGuideIds.add(row.guide_id);
    if (row.shared_with_id) sharedGuideIds.add(row.shared_with_id);
  });

  const { data: profiles } = await supabase
    .from("guide_profiles")
    .select("id,first_name,last_name")
    .in("id", Array.from(sharedGuideIds));
  (profiles || []).forEach((profile) => sharedGuideProfiles.set(profile.id, profile));
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
  const isLocalHost = ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
  const apiUrl = isLocalHost
    ? "https://walkingtours.vercel.app/api/review-booking-import"
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
  const apiUrl = "https://walkingtours.vercel.app/api/poll-bookings?token=danslecullabalayettelemancheetletiquette&use_llm=1";

  checkNewEmailsBtn.disabled = true;
  setStatus("Checking new emails...");

  try {
    const iframe = document.createElement("iframe");
    iframe.hidden = true;
    const loaded = new Promise((resolve) => {
      iframe.addEventListener("load", resolve, { once: true });
    });
    iframe.src = apiUrl;
    document.body.appendChild(iframe);

    await loaded;
    await sleep(300);
    iframe.remove();

    setStatus("Email check finished. Reloading imports...");
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
    .eq("from_email", normalizeEmail(session?.user?.email))
    .in("status", ["pending_review", "error", "ignored", "confirmed"])
    .order("created_at", { ascending: false });

  if (error) {
    setStatus(`Load error: ${error.message}`);
    return;
  }

  const visibleRows = (data || []).filter((draft) => {
    if (!draft.matched_tour_id) return true;
    const tour = toursById.get(draft.matched_tour_id);
    if (!tour) return true;
    return sharedGuideIds.has(tour.guide_id);
  });
  const drafts = visibleRows.filter((draft) => draft.status !== "confirmed");
  const confirmedRows = visibleRows.filter((draft) => draft.status === "confirmed");

  if (!drafts.length) {
    const empty = document.createElement("div");
    empty.textContent = "No booking imports to review.";
    bookingImportsList.appendChild(empty);
  }

  drafts.forEach((draft) => {
    const card = document.createElement("div");
    card.className = "details booking-import-card";

    const title = document.createElement("div");
    title.className = "details-title";
    title.textContent = draft.subject || "Imported email";
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "muted";
    meta.textContent = `${draft.from_email || "Unknown sender"} · ${formatShortDate(draft.received_at || draft.created_at)}`;
    card.appendChild(meta);

    const matchedTour = toursById.get(draft.matched_tour_id);
    const matchLine = document.createElement("div");
    matchLine.className = "readme-line";
    matchLine.textContent = `Matched tour: ${formatTourLabel(matchedTour)}`;
    card.appendChild(matchLine);

    const left = document.createElement("div");
    left.className = "booking-import-panel";
    const leftTitle = document.createElement("div");
    leftTitle.className = "details-title";
    leftTitle.textContent = "Proposed import";
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

    const toggleEmailBtn = document.createElement("button");
    toggleEmailBtn.type = "button";
    toggleEmailBtn.className = "ghost";
    toggleEmailBtn.textContent = "Show email";
    card.appendChild(toggleEmailBtn);

    const right = document.createElement("div");
    right.className = "booking-import-panel";
    right.hidden = true;

    const previewWrap = document.createElement("div");
    previewWrap.className = "booking-import-preview-wrap";

    if (draft.raw_html) {
      const previewFrame = document.createElement("iframe");
      previewFrame.className = "booking-import-preview";
      previewFrame.setAttribute("sandbox", "");
      previewFrame.srcdoc = draft.raw_html;
      previewWrap.appendChild(previewFrame);
    } else {
      const raw = document.createElement("pre");
      raw.className = "booking-import-raw";
      raw.textContent = draft.raw_text || "";
      previewWrap.appendChild(raw);
    }

    right.appendChild(previewWrap);

    toggleEmailBtn.addEventListener("click", () => {
      const shouldShow = right.hidden;
      right.hidden = !shouldShow;
      toggleEmailBtn.textContent = shouldShow ? "Hide email" : "Show email";
    });

    card.appendChild(left);
    card.appendChild(right);

    if (draft.error_message) {
      const errorLine = document.createElement("div");
      errorLine.className = "muted";
      errorLine.textContent = draft.error_message;
      card.appendChild(errorLine);
    }

    const actions = document.createElement("div");
    actions.className = "form-row";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "primary";
    confirmBtn.textContent = "Confirm import";
    confirmBtn.disabled = !draft.matched_tour_id || participants.length === 0;
    confirmBtn.addEventListener("click", async () => {
      const ok = await reviewDraft(draft.id, "confirm");
      if (ok) {
        setStatus("Import confirmed.");
        await loadDrafts();
      }
    });
    actions.appendChild(confirmBtn);

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "ghost danger";
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", async () => {
      const ok = await reviewDraft(draft.id, "reject");
      if (ok) {
        setStatus("Import rejected.");
        await loadDrafts();
      }
    });
    actions.appendChild(rejectBtn);

    card.appendChild(actions);
    bookingImportsList.appendChild(card);
  });

  if (!confirmedRows.length) {
    const emptyConfirmed = document.createElement("div");
    emptyConfirmed.textContent = "No confirmed imports yet.";
    confirmedBookingImportsList.appendChild(emptyConfirmed);
    return;
  }

  confirmedRows.forEach((draft) => {
    const row = document.createElement("div");
    row.className = "booking-import-confirmed";

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
    line2.textContent = `${formatTourLabel(matchedTour)} · ${draft.matched_platform_name || draft.llm_extraction?.platform_name || "Unknown"} · ${participantsCount} participants`;
    row.appendChild(line2);

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

checkNewEmailsBtn?.addEventListener("click", checkNewEmails);

init();
