import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription } from "./push.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const bookingImportsList = document.getElementById("bookingImportsList");
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
  const isLocalHost = ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
  const apiUrl = isLocalHost
    ? "https://walkingtours.vercel.app/api/poll-bookings"
    : "/api/poll-bookings";
  const { data: authData } = await supabase.auth.getSession();
  const accessToken = authData?.session?.access_token;
  if (!accessToken) {
    setStatus("Auth session missing.");
    return;
  }

  checkNewEmailsBtn.disabled = true;
  setStatus("Checking new emails...");

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ use_llm: true }),
    });
    const contentType = response.headers.get("content-type") || "";
    const result = contentType.includes("application/json")
      ? await response.json()
      : { ok: false, error: await response.text() };
    if (!response.ok || !result?.ok) {
      setStatus(result?.error || "Check new emails failed.");
      return;
    }

    setStatus(`Checked ${result.checked || 0} emails. ${result.imported || 0} import(s) ready for review.`);
    await loadToursIndex();
    await loadDrafts();
  } catch (error) {
    console.error("check new emails error", error);
    setStatus(error?.message || "Check new emails failed.");
  } finally {
    checkNewEmailsBtn.disabled = false;
  }
}

async function loadDrafts() {
  clearChildren(bookingImportsList);
  setStatus("");

  const { data, error } = await supabase
    .from("incoming_booking_emails")
    .select("id,subject,from_email,received_at,raw_text,matched_tour_id,matched_platform_name,imported_participants,llm_extraction,status,error_message,created_at")
    .in("status", ["pending_review", "error", "ignored"])
    .order("created_at", { ascending: false });

  if (error) {
    setStatus(`Load error: ${error.message}`);
    return;
  }

  const drafts = (data || []).filter((draft) => {
    if (!draft.matched_tour_id) return true;
    const tour = toursById.get(draft.matched_tour_id);
    return tour && sharedGuideIds.has(tour.guide_id);
  });

  if (!drafts.length) {
    const empty = document.createElement("div");
    empty.textContent = "No booking imports to review.";
    bookingImportsList.appendChild(empty);
    return;
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
    meta.textContent = `${draft.from_email || "Unknown sender"} · ${draft.received_at || draft.created_at || ""}`;
    card.appendChild(meta);

    const matchedTour = toursById.get(draft.matched_tour_id);
    const matchLine = document.createElement("div");
    matchLine.className = "readme-line";
    matchLine.textContent = `Matched tour: ${formatTourLabel(matchedTour)}`;
    card.appendChild(matchLine);

    const platformLine = document.createElement("div");
    platformLine.className = "readme-line";
    platformLine.textContent = `Platform: ${draft.matched_platform_name || draft.llm_extraction?.platform_name || "Unknown"}`;
    card.appendChild(platformLine);

    const proposed = document.createElement("div");
    proposed.className = "booking-import-columns";

    const left = document.createElement("div");
    left.className = "booking-import-panel";
    const leftTitle = document.createElement("div");
    leftTitle.className = "details-title";
    leftTitle.textContent = "Proposed import";
    left.appendChild(leftTitle);

    const participants = Array.isArray(draft.imported_participants) ? draft.imported_participants : [];
    const participantsText = document.createElement("div");
    participantsText.className = "readme-line";
    participantsText.textContent = participants.length
      ? participants.map((participant) => `${participant.name} (${participant.group_size})`).join(" · ")
      : "No participants proposed.";
    left.appendChild(participantsText);

    if (draft.llm_extraction?.confidence_notes) {
      const notes = document.createElement("div");
      notes.className = "muted";
      notes.textContent = draft.llm_extraction.confidence_notes;
      left.appendChild(notes);
    }

    const right = document.createElement("div");
    right.className = "booking-import-panel";
    const rightTitle = document.createElement("div");
    rightTitle.className = "details-title";
    rightTitle.textContent = "Email text";
    right.appendChild(rightTitle);

    const toggleEmailBtn = document.createElement("button");
    toggleEmailBtn.type = "button";
    toggleEmailBtn.className = "ghost";
    toggleEmailBtn.textContent = "Show email";
    right.appendChild(toggleEmailBtn);

    const raw = document.createElement("pre");
    raw.className = "booking-import-raw";
    raw.textContent = draft.raw_text || "";
    raw.hidden = true;
    right.appendChild(raw);

    toggleEmailBtn.addEventListener("click", () => {
      const shouldShow = raw.hidden;
      raw.hidden = !shouldShow;
      toggleEmailBtn.textContent = shouldShow ? "Hide email" : "Show email";
    });

    proposed.appendChild(left);
    proposed.appendChild(right);
    card.appendChild(proposed);

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
  await loadDrafts();
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
