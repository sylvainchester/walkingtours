import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription } from "./push.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const profileInfo = document.getElementById("profileInfo");
const importEmail = document.getElementById("importEmail");
const importEmail2 = document.getElementById("importEmail2");
const sortCode = document.getElementById("sortCode");
const accountNumber = document.getElementById("accountNumber");
const accountName = document.getElementById("accountName");
const saveProfile = document.getElementById("saveProfile");
const profileStatus = document.getElementById("profileStatus");
const signOutBtn = document.getElementById("signOutBtn");
const avatarButton = document.getElementById("avatarButton");
const avatarDropdown = document.getElementById("avatarDropdown");

let session = null;

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
  return /import_email/i.test(String(error?.message || ""));
}

async function loadGuideProfile(userId) {
  let { data: profile, error } = await supabase
    .from("guide_profiles")
    .select("first_name,last_name,email,import_email,import_email_2,sort_code,account_number,account_name")
    .eq("id", userId)
    .maybeSingle();

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
  sortCode.value = profile.sort_code || "";
  accountNumber.value = profile.account_number || "";
  accountName.value = profile.account_name || "";
}

async function saveBankDetails() {
  if (!session) return;
  const payload = {
    import_email: normalizeEmail(importEmail.value) || null,
    import_email_2: normalizeEmail(importEmail2.value) || null,
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
        sort_code: payload.sort_code,
        account_number: payload.account_number,
        account_name: payload.account_name,
      })
      .eq("id", session.user.id));
    if (!error) {
      setStatus("Saved. Run supabase_patch29.sql to enable the second booking import email alias.");
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
