import { createClient } from "./supabase-client.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription } from "./push.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const profileInfo = document.getElementById("profileInfo");
const importEmail = document.getElementById("importEmail");
const importEmail2 = document.getElementById("importEmail2");
const useCustomGuideColors = document.getElementById("useCustomGuideColors");
const guideColorRows = document.getElementById("guideColorRows");
const sortCode = document.getElementById("sortCode");
const accountNumber = document.getElementById("accountNumber");
const accountName = document.getElementById("accountName");
const saveProfile = document.getElementById("saveProfile");
const profileStatus = document.getElementById("profileStatus");
const signOutBtn = document.getElementById("signOutBtn");
const avatarButton = document.getElementById("avatarButton");
const avatarDropdown = document.getElementById("avatarDropdown");

let session = null;
let sharedGuideIds = [];
let sharedGuideProfiles = new Map();
let loadedGuideColorOverrides = {};

const GUIDE_COLOR_OPTIONS = [
  { value: "guide-color-1", label: "Green" },
  { value: "guide-color-2", label: "Blue" },
  { value: "guide-color-3", label: "Pink" },
  { value: "guide-color-4", label: "Violet" },
  { value: "guide-color-5", label: "Brown" },
];

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

function setStatus(message) {
  if (profileStatus) profileStatus.textContent = message || "";
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isMissingImportEmailColumn(error) {
  return /(import_email|import_email_2|color_mode|guide_color_overrides)/i.test(String(error?.message || ""));
}

function clearNode(node) {
  while (node?.firstChild) node.removeChild(node.firstChild);
}

function getDefaultOrderedGuideIds() {
  const ids = [...sharedGuideIds];
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

function getDefaultGuideColorClass(guideId) {
  const orderedIds = getDefaultOrderedGuideIds();
  const index = orderedIds.indexOf(guideId);
  if (index === -1) return GUIDE_COLOR_OPTIONS[0].value;
  return GUIDE_COLOR_OPTIONS[Math.min(index, GUIDE_COLOR_OPTIONS.length - 1)].value;
}

async function loadSharedGuidesForColorConfig() {
  sharedGuideIds = [session.user.id];
  sharedGuideProfiles = new Map();

  const { data: shareRows } = await supabase
    .from("guide_shares")
    .select("guide_id,shared_with_id")
    .or(`guide_id.eq.${session.user.id},shared_with_id.eq.${session.user.id}`);

  (shareRows || []).forEach((row) => {
    if (row.guide_id && !sharedGuideIds.includes(row.guide_id)) sharedGuideIds.push(row.guide_id);
    if (row.shared_with_id && !sharedGuideIds.includes(row.shared_with_id)) sharedGuideIds.push(row.shared_with_id);
  });

  const { data: profiles } = await supabase
    .from("guide_profiles")
    .select("id,first_name,last_name")
    .in("id", sharedGuideIds);

  (profiles || []).forEach((profile) => {
    sharedGuideProfiles.set(profile.id, profile);
  });
}

function renderGuideColorRows() {
  if (!guideColorRows) return;
  clearNode(guideColorRows);
  if (!useCustomGuideColors?.checked) return;

  const orderedIds = getDefaultOrderedGuideIds();
  orderedIds.forEach((guideId) => {
    const row = document.createElement("div");
    row.className = "form-row";

    const label = document.createElement("div");
    label.className = "muted";
    const profile = sharedGuideProfiles.get(guideId);
    label.textContent = profile
      ? `${profile.first_name} ${profile.last_name}`
      : guideId;
    row.appendChild(label);

    const select = document.createElement("select");
    select.className = "select";
    select.dataset.guideId = guideId;
    const selected = String(
      loadedGuideColorOverrides?.[guideId] || getDefaultGuideColorClass(guideId)
    );
    GUIDE_COLOR_OPTIONS.forEach((optionDef) => {
      const option = document.createElement("option");
      option.value = optionDef.value;
      option.textContent = optionDef.label;
      if (selected === optionDef.value) {
        option.selected = true;
      }
      select.appendChild(option);
    });
    row.appendChild(select);
    guideColorRows.appendChild(row);
  });
}

async function loadGuideProfile(userId) {
  let { data: profile, error } = await supabase
    .from("guide_profiles")
    .select("first_name,last_name,email,import_email,import_email_2,color_mode,guide_color_overrides,sort_code,account_number,account_name")
    .eq("id", userId)
    .maybeSingle();

  if (error && isMissingImportEmailColumn(error)) {
    ({ data: profile, error } = await supabase
      .from("guide_profiles")
      .select("first_name,last_name,email,import_email,import_email_2,sort_code,account_number,account_name")
      .eq("id", userId)
      .maybeSingle());
    if (profile) {
      profile.color_mode = "auto";
      profile.guide_color_overrides = {};
    }
  }

  if (error && isMissingImportEmailColumn(error)) {
    ({ data: profile, error } = await supabase
      .from("guide_profiles")
      .select("first_name,last_name,email,import_email,sort_code,account_number,account_name")
      .eq("id", userId)
      .maybeSingle());
    if (profile) profile.import_email_2 = null;
  }

  if (error && isMissingImportEmailColumn(error)) {
    ({ data: profile, error } = await supabase
      .from("guide_profiles")
      .select("first_name,last_name,email,sort_code,account_number,account_name")
      .eq("id", userId)
      .maybeSingle());
    if (profile) {
      profile.import_email = null;
      profile.import_email_2 = null;
      profile.color_mode = "auto";
      profile.guide_color_overrides = {};
    }
  }

  return { profile, error };
}

async function loadProfile() {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (!session) {
    window.location.href = "sign-in.html";
    return;
  }
  await ensurePushSubscription(supabase, session);
  await refreshShareInviteIndicators();

  const { profile, error } = await loadGuideProfile(session.user.id);

  if (error || !profile) {
    setStatus(error?.message || "Profile not found.");
    return;
  }

  clearChildren(profileInfo);
  const info = document.createElement("div");
  info.textContent = `${profile.first_name} ${profile.last_name} · ${profile.email}`;
  profileInfo.appendChild(info);

  importEmail.value = profile.import_email || "";
  importEmail2.value = profile.import_email_2 || "";
  useCustomGuideColors.checked = profile.color_mode === "custom";
  loadedGuideColorOverrides = (profile.guide_color_overrides && typeof profile.guide_color_overrides === "object")
    ? profile.guide_color_overrides
    : {};
  await loadSharedGuidesForColorConfig();
  renderGuideColorRows();
  sortCode.value = profile.sort_code || "";
  accountNumber.value = profile.account_number || "";
  accountName.value = profile.account_name || "";
}

async function saveBankDetails() {
  if (!session) return;
  const colorOverrides = {};
  guideColorRows?.querySelectorAll("select[data-guide-id]").forEach((select) => {
    const guideId = select.dataset.guideId;
    const colorValue = select.value;
    if (guideId && GUIDE_COLOR_OPTIONS.some((option) => option.value === colorValue)) {
      colorOverrides[guideId] = colorValue;
    }
  });

  const payload = {
    import_email: normalizeEmail(importEmail.value) || null,
    import_email_2: normalizeEmail(importEmail2.value) || null,
    color_mode: useCustomGuideColors?.checked ? "custom" : "auto",
    guide_color_overrides: colorOverrides,
    sort_code: sortCode.value.trim() || null,
    account_number: accountNumber.value.trim() || null,
    account_name: accountName.value.trim() || null,
  };

  let { error } = await supabase
    .from("guide_profiles")
    .update(payload)
    .eq("id", session.user.id);

  if (error && isMissingImportEmailColumn(error)) {
    ({ error } = await supabase
      .from("guide_profiles")
      .update({
        import_email: payload.import_email,
        import_email_2: payload.import_email_2,
        sort_code: payload.sort_code,
        account_number: payload.account_number,
        account_name: payload.account_name,
      })
      .eq("id", session.user.id));
    if (!error) {
      setStatus("Saved. Run supabase_patch30.sql to enable custom guide colors.");
      return;
    }
  }

  if (error && isMissingImportEmailColumn(error)) {
    ({ error } = await supabase
      .from("guide_profiles")
      .update({
        sort_code: payload.sort_code,
        account_number: payload.account_number,
        account_name: payload.account_name,
      })
      .eq("id", session.user.id));
    if (!error) {
      setStatus("Saved. Run supabase_patch28.sql and supabase_patch29.sql to enable booking import email aliases.");
      return;
    }
  }

  if (error) {
    setStatus(`Save error: ${error.message}`);
  } else {
    setStatus("Saved.");
  }
}

saveProfile.addEventListener("click", saveBankDetails);
useCustomGuideColors?.addEventListener("change", renderGuideColorRows);

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

loadProfile();
