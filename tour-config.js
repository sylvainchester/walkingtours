import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription } from "./push.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const typeName = document.getElementById("typeName");
const ticketPrice = document.getElementById("ticketPrice");
const commission = document.getElementById("commission");
const invoiceOrgName = document.getElementById("invoiceOrgName");
const invoiceOrgAddress = document.getElementById("invoiceOrgAddress");
const typeDescription = document.getElementById("typeDescription");
const paymentType = document.getElementById("paymentType");
const typeShareable = document.getElementById("typeShareable");
const feePerParticipant = document.getElementById("feePerParticipant");
const addType = document.getElementById("addType");
const typeStatus = document.getElementById("typeStatus");
const typesList = document.getElementById("typesList");
const signOutBtn = document.getElementById("signOutBtn");
const enablePushBtn = document.getElementById("enablePushBtn");
const avatarButton = document.getElementById("avatarButton");
const avatarDropdown = document.getElementById("avatarDropdown");
const typeModal = document.getElementById("typeModal");
const typeModalBody = document.getElementById("typeModalBody");
const typeModalClose = document.getElementById("typeModalClose");

let session = null;
let sharedGuideIds = new Set();
let sharedGuideProfiles = new Map();
let activeType = null;

function setStatus(message) {
  if (typeStatus) typeStatus.textContent = message || "";
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function openTypeModal(type) {
  if (!typeModal || !typeModalBody) return;
  activeType = type;
  typeModal.classList.add("open");
  typeModal.setAttribute("aria-hidden", "false");
  renderTypeModal(type);
}

function closeTypeModal() {
  if (!typeModal || !typeModalBody) return;
  typeModal.classList.remove("open");
  typeModal.setAttribute("aria-hidden", "true");
  activeType = null;
}

function renderTypeModal(type) {
  clearChildren(typeModalBody);
  const isOwner = type.guide_id === session.user.id;

  const form = document.createElement("div");
  form.className = "form-col";

  const makeLabeled = (labelText, inputEl) => {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const label = document.createElement("span");
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(inputEl);
    return wrap;
  };

  const paymentSelect = document.createElement("select");
  paymentSelect.className = "select";
  ["prepaid", "free"].forEach((val) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val === "prepaid" ? "Pre-paid" : "Free tour";
    if ((type.payment_type || "prepaid") === val) opt.selected = true;
    paymentSelect.appendChild(opt);
  });

  const nameInput = document.createElement("input");
  nameInput.className = "input";
  nameInput.value = type.name || "";

  const shareableInput = document.createElement("input");
  shareableInput.className = "checkbox";
  shareableInput.type = "checkbox";
  shareableInput.checked = type.shareable !== false;

  const priceInput = document.createElement("input");
  priceInput.className = "input";
  priceInput.type = "number";
  priceInput.step = "0.01";
  priceInput.value = type.ticket_price ?? "";

  const commissionInput = document.createElement("input");
  commissionInput.className = "input";
  commissionInput.type = "number";
  commissionInput.step = "0.01";
  commissionInput.value = type.commission_percent ?? "";

  const orgNameInput = document.createElement("input");
  orgNameInput.className = "input";
  orgNameInput.value = type.invoice_org_name || "";

  const orgAddressInput = document.createElement("input");
  orgAddressInput.className = "input";
  orgAddressInput.value = type.invoice_org_address || "";

  const feeInput = document.createElement("input");
  feeInput.className = "input";
  feeInput.type = "number";
  feeInput.step = "0.01";
  feeInput.value = type.fee_per_participant ?? "";

  const descInput = document.createElement("input");
  descInput.className = "input";
  descInput.value = type.description || "";

  [paymentSelect, shareableInput, nameInput, priceInput, commissionInput, orgNameInput, orgAddressInput, feeInput, descInput].forEach((el) => {
    el.disabled = !isOwner;
  });

  const paymentWrap = makeLabeled("Payment type", paymentSelect);
  const shareableWrap = makeLabeled("Shareable", shareableInput);
  const nameWrap = makeLabeled("Tour name", nameInput);
  const priceWrap = makeLabeled("Ticket price", priceInput);
  const commissionWrap = makeLabeled("Commission %", commissionInput);
  const orgNameWrap = makeLabeled("Invoice org name", orgNameInput);
  const orgAddressWrap = makeLabeled("Invoice email", orgAddressInput);
  const feeWrap = makeLabeled("Fee per participant", feeInput);
  const descWrap = makeLabeled("Description", descInput);

  const applyPaymentVisibility = () => {
    const isFree = paymentSelect.value === "free";
    priceWrap.style.display = isFree ? "none" : "";
    commissionWrap.style.display = isFree ? "none" : "";
    orgNameWrap.style.display = isFree ? "none" : "";
    orgAddressWrap.style.display = isFree ? "none" : "";
    feeWrap.style.display = isFree ? "" : "none";
  };
  applyPaymentVisibility();
  paymentSelect.addEventListener("change", applyPaymentVisibility);

  const saveBtn = document.createElement("button");
  saveBtn.className = "primary";
  saveBtn.type = "button";
  saveBtn.textContent = "Save";
  saveBtn.disabled = !isOwner;
  saveBtn.addEventListener("click", async () => {
    if (!isOwner) return;
    const prevShareable = type.shareable !== false;
    const { error: updateError } = await supabase
      .from("tour_types")
      .update({
        payment_type: paymentSelect.value,
        shareable: shareableInput.checked,
        name: nameInput.value.trim(),
        ticket_price: priceInput.value === "" ? null : Number(priceInput.value),
        commission_percent: commissionInput.value === "" ? null : Number(commissionInput.value),
        invoice_org_name: orgNameInput.value.trim() || null,
        invoice_org_address: orgAddressInput.value.trim() || null,
        fee_per_participant: feeInput.value === "" ? null : Number(feeInput.value),
        description: descInput.value.trim() || null,
      })
      .eq("id", type.id);
    if (updateError) {
      setStatus(`Save error: ${updateError.message}`);
    } else {
      if (prevShareable !== shareableInput.checked) {
        await supabase
          .from("tours")
          .update({ is_private: shareableInput.checked ? false : true })
          .eq("guide_id", type.guide_id)
          .eq("type", type.name);
      }
      setStatus("Saved.");
      await loadTypes();
      closeTypeModal();
    }
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "ghost";
  deleteBtn.type = "button";
  deleteBtn.textContent = "Delete";
  deleteBtn.disabled = !isOwner;
  deleteBtn.addEventListener("click", async () => {
    if (!isOwner) return;
    if (!confirm("Delete this tour type?")) return;
    const { error: deleteError } = await supabase.from("tour_types").delete().eq("id", type.id);
    if (deleteError) {
      setStatus(`Delete error: ${deleteError.message}`);
    } else {
      await loadTypes();
      closeTypeModal();
    }
  });

  form.appendChild(paymentWrap);
  form.appendChild(shareableWrap);
  form.appendChild(nameWrap);
  form.appendChild(priceWrap);
  form.appendChild(commissionWrap);
  form.appendChild(orgNameWrap);
  form.appendChild(orgAddressWrap);
  form.appendChild(feeWrap);
  form.appendChild(descWrap);

  const actions = document.createElement("div");
  actions.className = "form-row";
  actions.appendChild(saveBtn);
  actions.appendChild(deleteBtn);
  form.appendChild(actions);

  typeModalBody.appendChild(form);
}

async function loadSharedGuides() {
  sharedGuideIds = new Set();
  sharedGuideProfiles = new Map();
  if (!session) return;
  sharedGuideIds.add(session.user.id);

  const { data, error } = await supabase
    .from("guide_shares")
    .select("guide_id,shared_with_id")
    .or(`guide_id.eq.${session.user.id},shared_with_id.eq.${session.user.id}`);

  if (!error && data) {
    data.forEach((row) => {
      if (row.guide_id) sharedGuideIds.add(row.guide_id);
      if (row.shared_with_id) sharedGuideIds.add(row.shared_with_id);
    });
  }

  const { data: profiles } = await supabase
    .from("guide_profiles")
    .select("id,first_name,last_name,email")
    .in("id", Array.from(sharedGuideIds));

  if (profiles) {
    profiles.forEach((p) => sharedGuideProfiles.set(p.id, p));
  }
}

async function loadTypes() {
  clearChildren(typesList);
  if (!session) return;

  const { data, error } = await supabase
    .from("tour_types")
    .select("id,guide_id,name,description,ticket_price,commission_percent,invoice_org_name,invoice_org_address,payment_type,fee_per_participant,shareable")
    .order("name");

  if (error) {
    setStatus(`Load error: ${error.message}`);
    return;
  }

  if (!data || data.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "No tour types yet.";
    typesList.appendChild(empty);
    return;
  }

  data.forEach((type) => {
    const ownerProfile = sharedGuideProfiles.get(type.guide_id);
    const ownerName = ownerProfile
      ? `${ownerProfile.first_name} ${ownerProfile.last_name}`
      : "Unknown";

    const row = document.createElement("button");
    row.type = "button";
    row.className = "tour-row accepted";
    row.textContent = `${type.name} · ${ownerName}`;
    row.addEventListener("click", () => openTypeModal(type));
    typesList.appendChild(row);
  });
}

async function addNewType() {
  if (!session) return;
  const name = typeName.value.trim();
  if (!name) {
    setStatus("Tour name is required.");
    return;
  }
  const isFree = paymentType.value === "free";
  if (isFree) {
    if (feePerParticipant.value === "") {
      setStatus("Fee per participant is required for free tours.");
      return;
    }
  } else {
    if (ticketPrice.value === "" || commission.value === "" || invoiceOrgName.value.trim() === "") {
      setStatus("Ticket price, commission, and invoice org name are required.");
      return;
    }
  }

  const { data: existing, error: existingError } = await supabase
    .from("tour_types")
    .select("id")
    .eq("guide_id", session.user.id)
    .ilike("name", name)
    .maybeSingle();
  if (existingError) {
    setStatus(`Check error: ${existingError.message}`);
    return;
  }
  if (existing) {
    setStatus("You already have a tour type with this name.");
    return;
  }

  const { error } = await supabase.from("tour_types").insert({
    guide_id: session.user.id,
    payment_type: paymentType.value,
    shareable: typeShareable ? typeShareable.checked : true,
    name,
    description: typeDescription.value.trim() || null,
    ticket_price: isFree ? null : (ticketPrice.value === "" ? null : Number(ticketPrice.value)),
    commission_percent: isFree ? null : (commission.value === "" ? null : Number(commission.value)),
    invoice_org_name: isFree ? null : (invoiceOrgName.value.trim() || null),
    invoice_org_address: isFree ? null : (invoiceOrgAddress.value.trim() || null),
    fee_per_participant: isFree ? (feePerParticipant.value === "" ? null : Number(feePerParticipant.value)) : null,
  });
  if (error) {
    setStatus(`Add error: ${error.message}`);
  } else {
    setStatus("Type added.");
    paymentType.value = "prepaid";
    if (typeShareable) typeShareable.checked = true;
    typeName.value = "";
    ticketPrice.value = "";
    commission.value = "";
    invoiceOrgName.value = "";
    invoiceOrgAddress.value = "";
    feePerParticipant.value = "";
    typeDescription.value = "";
    await loadTypes();
  }
}

function applyNewTypeVisibility() {
  const isFree = paymentType.value === "free";
  ticketPrice.parentElement.style.display = isFree ? "none" : "";
  commission.parentElement.style.display = isFree ? "none" : "";
  invoiceOrgName.parentElement.style.display = isFree ? "none" : "";
  invoiceOrgAddress.parentElement.style.display = isFree ? "none" : "";
  feePerParticipant.parentElement.style.display = isFree ? "" : "none";
}

async function init() {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (!session) {
    window.location.href = "sign-in.html";
    return;
  }
  await ensurePushSubscription(supabase, session);
  await loadSharedGuides();
  await loadTypes();
}

if (addType) addType.addEventListener("click", addNewType);
if (paymentType) {
  paymentType.addEventListener("change", applyNewTypeVisibility);
  applyNewTypeVisibility();
}

if (signOutBtn) {
  signOutBtn.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "sign-in.html";
  });
}

if (enablePushBtn) {
  enablePushBtn.addEventListener("click", async () => {
    if (!session) return;
    await ensurePushSubscription(supabase, session);
    avatarDropdown?.classList.remove("open");
    alert("Notifications enabled (if allowed by your browser).");
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

if (typeModalClose) typeModalClose.addEventListener("click", closeTypeModal);
if (typeModal) {
  typeModal.addEventListener("click", (event) => {
    if (event.target && event.target.dataset && event.target.dataset.close === "true") {
      closeTypeModal();
    }
  });
}

init();
