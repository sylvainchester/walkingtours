import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const newPassword = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");
const updatePasswordBtn = document.getElementById("updatePasswordBtn");
const authStatus = document.getElementById("authStatus");

function setStatus(message) {
  if (authStatus) authStatus.textContent = message || "";
}

async function restoreRecoverySession() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  const type = hash.get("type");

  if (type === "recovery" && accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      setStatus(`Recovery link error: ${error.message}`);
      return false;
    }
    window.history.replaceState({}, document.title, "./reset-password.html");
    return true;
  }

  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

async function handleUpdatePassword() {
  const password = newPassword?.value || "";
  const confirm = confirmPassword?.value || "";

  if (!password || !confirm) {
    setStatus("Enter the new password twice.");
    return;
  }
  if (password !== confirm) {
    setStatus("Passwords do not match.");
    return;
  }
  if (password.length < 6) {
    setStatus("Password must be at least 6 characters.");
    return;
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    setStatus(`Password update error: ${error.message}`);
    return;
  }

  setStatus("Password updated. Redirecting to sign in...");
  setTimeout(() => {
    window.location.href = "sign-in.html";
  }, 800);
}

updatePasswordBtn?.addEventListener("click", handleUpdatePassword);

restoreRecoverySession().then((ok) => {
  if (!ok) {
    setStatus("Invalid or expired recovery link. Request a new password reset.");
  }
});
