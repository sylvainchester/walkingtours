import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription, sendPush } from "./push.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const shareSelect = document.getElementById("shareSelect");
const shareBtn = document.getElementById("shareBtn");
const shareStatus = document.getElementById("shareStatus");
const shareList = document.getElementById("shareList");
const pendingList = document.getElementById("pendingList");
let session = null;
const signOutBtn = document.getElementById("signOutBtn");
const enablePushBtn = document.getElementById("enablePushBtn");
const avatarButton = document.getElementById("avatarButton");
const avatarDropdown = document.getElementById("avatarDropdown");

function setStatus(message) {
  if (shareStatus) shareStatus.textContent = message || "";
}

async function init() {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (!session) {
    window.location.href = "sign-in.html";
    return;
  }
  await ensurePushSubscription(supabase, session);
  await loadGuideOptions();
  await loadShares();
  await loadPendingInvites();
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

async function loadGuideOptions() {
  if (!session) return;
  clearChildren(shareSelect);

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a guide";
  shareSelect.appendChild(placeholder);

  const { data: profiles, error } = await supabase
    .from("guide_profiles")
    .select("id,email,first_name,last_name")
    .order("email");

  if (error) {
    setStatus(`Load error: ${error.message}`);
    return;
  }

  profiles
    .filter((p) => p.id !== session.user.id)
    .forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.email;
      option.textContent = `${profile.first_name} ${profile.last_name} (${profile.email})`;
      shareSelect.appendChild(option);
    });
}

async function loadShares() {
  if (!session) return;
  clearChildren(shareList);
  clearChildren(pendingList);

  const { data: shares, error } = await supabase
    .from("guide_shares")
    .select("id,guide_id,shared_with_id,created_at")
    .or(`guide_id.eq.${session.user.id},shared_with_id.eq.${session.user.id}`)
    .order("created_at", { ascending: false });

  if (error) {
    setStatus(`Load error: ${error.message}`);
    return;
  }

  if (!shares || shares.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "No active shares.";
    shareList.appendChild(empty);
    return;
  }

  const ids = new Set();
  shares.forEach((s) => {
    ids.add(s.guide_id);
    ids.add(s.shared_with_id);
  });

  const { data: profiles, error: profileError } = await supabase
    .from("guide_profiles")
    .select("id,email,first_name,last_name")
    .in("id", Array.from(ids));

  if (profileError) {
    setStatus(`Profile error: ${profileError.message}`);
    return;
  }

  const profileMap = new Map();
  (profiles || []).forEach((p) => {
    profileMap.set(p.id, p);
  });

  shares.forEach((share) => {
    const isOwner = share.guide_id === session.user.id;
    const otherId = isOwner ? share.shared_with_id : share.guide_id;
    const profile = profileMap.get(otherId);
    const label = profile
      ? `${profile.first_name} ${profile.last_name} (${profile.email})`
      : otherId;
    const direction = isOwner ? "Shared with" : "Shared by";

    const row = document.createElement("div");
    row.className = "participant";

    const text = document.createElement("div");
    text.textContent = `${direction}: ${label}`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      const { error: deleteError } = await supabase
        .from("guide_shares")
        .delete()
        .eq("id", share.id);
      if (deleteError) {
        setStatus(`Delete error: ${deleteError.message}`);
      } else {
        await loadShares();
      }
    });

    row.appendChild(text);
    row.appendChild(remove);
    shareList.appendChild(row);
  });
}

async function loadPendingInvites() {
  if (!session) return;
  clearChildren(pendingList);

  const { data: invites, error } = await supabase
    .from("guide_share_invites")
    .select("id,from_guide_id,to_guide_id,status,created_at")
    .or(`from_guide_id.eq.${session.user.id},to_guide_id.eq.${session.user.id}`)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    setStatus(`Invite load error: ${error.message}`);
    return;
  }

  if (!invites || invites.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "No pending invites.";
    pendingList.appendChild(empty);
    return;
  }

  const ids = new Set();
  invites.forEach((i) => {
    ids.add(i.from_guide_id);
    ids.add(i.to_guide_id);
  });

  const { data: profiles, error: profileError } = await supabase
    .from("guide_profiles")
    .select("id,email,first_name,last_name")
    .in("id", Array.from(ids));

  if (profileError) {
    setStatus(`Profile error: ${profileError.message}`);
    return;
  }

  const profileMap = new Map();
  (profiles || []).forEach((p) => profileMap.set(p.id, p));

  invites.forEach((invite) => {
    const isOutgoing = invite.from_guide_id === session.user.id;
    const otherId = isOutgoing ? invite.to_guide_id : invite.from_guide_id;
    const profile = profileMap.get(otherId);
    const label = profile
      ? `${profile.first_name} ${profile.last_name} (${profile.email})`
      : otherId;
    const direction = isOutgoing ? "Sent to" : "Received from";

    const row = document.createElement("div");
    row.className = "participant";

    const text = document.createElement("div");
    text.textContent = `${direction}: ${label}`;

    row.appendChild(text);

    if (!isOutgoing) {
      const actions = document.createElement("div");
      actions.className = "form-row";

      const acceptBtn = document.createElement("button");
      acceptBtn.type = "button";
      acceptBtn.className = "primary";
      acceptBtn.textContent = "Accept";
      acceptBtn.addEventListener("click", async () => {
        const { error: acceptError } = await supabase
          .from("guide_share_invites")
          .update({ status: "accepted" })
          .eq("id", invite.id);

        if (acceptError) {
          setStatus(`Accept error: ${acceptError.message}`);
          return;
        }

        const { error: shareError } = await supabase.from("guide_shares").insert({
          guide_id: session.user.id,
          shared_with_id: invite.from_guide_id,
        });

        if (shareError) {
          setStatus(`Share error: ${shareError.message}`);
          return;
        }

        if (invite.from_guide_id !== session.user.id) {
          await sendPush(supabase, {
            to_user_id: invite.from_guide_id,
            title: "Share accepted",
            body: "Your calendar share was accepted.",
            data: { url: "./share.html" },
          });
        }

        await loadShares();
        await loadPendingInvites();
      });

      const declineBtn = document.createElement("button");
      declineBtn.type = "button";
      declineBtn.className = "ghost";
      declineBtn.textContent = "Decline";
      declineBtn.addEventListener("click", async () => {
        const { error: declineError } = await supabase
          .from("guide_share_invites")
          .update({ status: "declined" })
          .eq("id", invite.id);
        if (declineError) {
          setStatus(`Decline error: ${declineError.message}`);
          return;
        }
        if (invite.from_guide_id !== session.user.id) {
          await sendPush(supabase, {
            to_user_id: invite.from_guide_id,
            title: "Share declined",
            body: "Your calendar share was declined.",
            data: { url: "./share.html" },
          });
        }
        await loadPendingInvites();
      });

      actions.appendChild(acceptBtn);
      actions.appendChild(declineBtn);
      row.appendChild(actions);
    }

    pendingList.appendChild(row);
  });
}

async function handleShare() {
  const email = (shareSelect.value || "").trim().toLowerCase();
  if (!email) {
    setStatus("Select a guide.");
    return;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  session = sessionData.session;
  if (!session) {
    window.location.href = "sign-in.html";
    return;
  }

  if (session.user.email?.toLowerCase() === email) {
    setStatus("You are already the owner of this calendar.");
    return;
  }

  const { data: profiles, error: profileError } = await supabase
    .from("guide_profiles")
    .select("id,email")
    .eq("email", email)
    .limit(1);

  if (profileError) {
    setStatus(`Lookup error: ${profileError.message}`);
    return;
  }

  if (!profiles || profiles.length === 0) {
    setStatus("No guide found with that email.");
    return;
  }

  const targetId = profiles[0].id;

  const { data: existing, error: existingError } = await supabase
    .from("guide_share_invites")
    .select("id,status")
    .eq("from_guide_id", session.user.id)
    .eq("to_guide_id", targetId)
    .maybeSingle();

  if (existingError) {
    setStatus(`Share error: ${existingError.message}`);
    return;
  }

  if (existing) {
    if (existing.status === "accepted") {
      setStatus("Already shared with this guide.");
      return;
    }
    if (existing.status === "pending") {
      setStatus("Invite already pending.");
      return;
    }
    const { error: updateError } = await supabase
      .from("guide_share_invites")
      .update({ status: "pending" })
      .eq("id", existing.id);
    if (updateError) {
      setStatus(`Share error: ${updateError.message}`);
      return;
    }
  } else {
    const { error: insertError } = await supabase.from("guide_share_invites").insert({
      from_guide_id: session.user.id,
      to_guide_id: targetId,
      status: "pending",
    });
    if (insertError) {
      setStatus(`Share error: ${insertError.message}`);
      return;
    }
  }

  setStatus("Invite sent. Waiting for acceptance.");
  await sendPush(supabase, {
    to_user_id: targetId,
    title: "Share invite",
    body: "You have a new calendar share invite.",
    data: { url: "./share.html" },
  });
  shareSelect.value = "";
  await loadPendingInvites();
}

shareBtn.addEventListener("click", handleShare);

if (enablePushBtn) {
  enablePushBtn.addEventListener("click", async () => {
    if (!session) return;
    await ensurePushSubscription(supabase, session);
    avatarDropdown?.classList.remove("open");
    alert("Notifications enabled (if allowed by your browser).");
  });
}

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
init();
