import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription } from "./push.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const profileInfo = document.getElementById("profileInfo");
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

async function loadProfile() {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (!session) {
    window.location.href = "sign-in.html";
    return;
  }
  await ensurePushSubscription(supabase, session);
  await refreshShareInviteIndicators();

  const { data: profile, error } = await supabase
    .from("guide_profiles")
    .select("first_name,last_name,email,sort_code,account_number,account_name")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error || !profile) {
    setStatus("Profile not found.");
    return;
  }

  clearChildren(profileInfo);
  const info = document.createElement("div");
  info.textContent = `${profile.first_name} ${profile.last_name} · ${profile.email}`;
  profileInfo.appendChild(info);

  sortCode.value = profile.sort_code || "";
  accountNumber.value = profile.account_number || "";
  accountName.value = profile.account_name || "";
}

async function saveBankDetails() {
  if (!session) return;
  const { error } = await supabase
    .from("guide_profiles")
    .update({
      sort_code: sortCode.value.trim() || null,
      account_number: accountNumber.value.trim() || null,
      account_name: accountName.value.trim() || null,
    })
    .eq("id", session.user.id);

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
