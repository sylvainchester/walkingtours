import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const typeName = document.getElementById("typeName");
const ticketPrice = document.getElementById("ticketPrice");
const commission = document.getElementById("commission");
const invoiceOrgName = document.getElementById("invoiceOrgName");
const invoiceOrgAddress = document.getElementById("invoiceOrgAddress");
const typeDescription = document.getElementById("typeDescription");
const addType = document.getElementById("addType");
const typeStatus = document.getElementById("typeStatus");
const typesList = document.getElementById("typesList");
const signOutBtn = document.getElementById("signOutBtn");
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
  form.className = "form-row";

  const makeLabeled = (labelText, inputEl) => {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const label = document.createElement("span");
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(inputEl);
    return wrap;
  };

  const nameInput = document.createElement("input");
  nameInput.className = "input";
  nameInput.value = type.name || "";

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

  const descInput = document.createElement("input");
  descInput.className = "input";
  descInput.value = type.description || "";

  [nameInput, priceInput, commissionInput, orgNameInput, orgAddressInput, descInput].forEach((el) => {
    el.disabled = !isOwner;
  });

  const saveBtn = document.createElement("button");
  saveBtn.className = "primary";
  saveBtn.type = "button";
  saveBtn.textContent = "Save";
  saveBtn.disabled = !isOwner;
  saveBtn.addEventListener("click", async () => {
    if (!isOwner) return;
    const { error: updateError } = await supabase
      .from("tour_types")
      .update({
        name: nameInput.value.trim(),
        ticket_price: priceInput.value === "" ? null : Number(priceInput.value),
        commission_percent: commissionInput.value === "" ? null : Number(commissionInput.value),
        invoice_org_name: orgNameInput.value.trim() || null,
        invoice_org_address: orgAddressInput.value.trim() || null,
        description: descInput.value.trim() || null,
      })
      .eq("id", type.id);
    if (updateError) {
      setStatus(`Save error: ${updateError.message}`);
    } else {
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

  form.appendChild(makeLabeled("Tour name", nameInput));
  form.appendChild(makeLabeled("Ticket price", priceInput));
  form.appendChild(makeLabeled("Commission %", commissionInput));
  form.appendChild(makeLabeled("Invoice org name", orgNameInput));
  form.appendChild(makeLabeled("Invoice org address", orgAddressInput));
  form.appendChild(makeLabeled("Description", descInput));
  form.appendChild(saveBtn);
  form.appendChild(deleteBtn);

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
    .select("id,guide_id,name,description,ticket_price,commission_percent,invoice_org_name,invoice_org_address")
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
  const { error } = await supabase.from("tour_types").insert({
    guide_id: session.user.id,
    name,
    description: typeDescription.value.trim() || null,
    ticket_price: ticketPrice.value === "" ? null : Number(ticketPrice.value),
    commission_percent: commission.value === "" ? null : Number(commission.value),
    invoice_org_name: invoiceOrgName.value.trim() || null,
    invoice_org_address: invoiceOrgAddress.value.trim() || null,
  });
  if (error) {
    setStatus(`Add error: ${error.message}`);
  } else {
    setStatus("Type added.");
    typeName.value = "";
    ticketPrice.value = "";
    commission.value = "";
    invoiceOrgName.value = "";
    invoiceOrgAddress.value = "";
    typeDescription.value = "";
    await loadTypes();
  }
}

async function init() {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (!session) {
    window.location.href = "sign-in.html";
    return;
  }
  await loadSharedGuides();
  await loadTypes();
}

if (addType) addType.addEventListener("click", addNewType);

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

if (typeModalClose) typeModalClose.addEventListener("click", closeTypeModal);
if (typeModal) {
  typeModal.addEventListener("click", (event) => {
    if (event.target && event.target.dataset && event.target.dataset.close === "true") {
      closeTypeModal();
    }
  });
}

init();
