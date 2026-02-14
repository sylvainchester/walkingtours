import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const firstName = document.getElementById("firstName");
const lastName = document.getElementById("lastName");
const signInBtn = document.getElementById("signInBtn");
const signUpBtn = document.getElementById("signUpBtn");
const recoverBtn = document.getElementById("recoverBtn");
const authStatus = document.getElementById("authStatus");

function setStatus(message) {
  if (authStatus) authStatus.textContent = message || "";
}

async function handleSignIn() {
  const email = authEmail?.value.trim();
  const password = authPassword?.value;
  if (!email || !password) {
    setStatus("Email and password required.");
    return;
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    setStatus(`Sign-in error: ${error.message}`);
  } else {
    window.location.href = "index.html";
  }
}

async function handleSignUp() {
  const email = authEmail?.value.trim();
  const password = authPassword?.value;
  const first = firstName?.value.trim();
  const last = lastName?.value.trim();

  if (!first || !last) {
    setStatus("First name and last name are required.");
    return;
  }

  if (!email || !password) {
    setStatus("Email and password required.");
    return;
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: first,
        last_name: last,
      },
    },
  });

  if (error) {
    setStatus(`Sign-up error: ${error.message}`);
    return;
  }

  if (data?.user && !data?.session) {
    setStatus("Check your email to confirm the account.");
  } else {
    window.location.href = "index.html";
  }
}

async function handleRecover() {
  const email = authEmail?.value.trim();
  if (!email) {
    setStatus("Email required.");
    return;
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/sign-in.html`,
  });
  if (error) {
    setStatus(`Recover error: ${error.message}`);
  } else {
    setStatus("Password reset email sent.");
  }
}

if (signInBtn) signInBtn.addEventListener("click", handleSignIn);
if (signUpBtn) signUpBtn.addEventListener("click", handleSignUp);
if (recoverBtn) recoverBtn.addEventListener("click", handleRecover);
