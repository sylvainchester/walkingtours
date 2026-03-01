import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ensurePushSubscription } from "./push.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const typeName = document.getElementById("typeName");
const ticketPrice = document.getElementById("ticketPrice");
const paymentType = document.getElementById("paymentType");
const typeShareable = document.getElementById("typeShareable");
const feePerParticipant = document.getElementById("feePerParticipant");
const addType = document.getElementById("addType");
const typeStatus = document.getElementById("typeStatus");
const typesList = document.getElementById("typesList");
const signOutBtn = document.getElementById("signOutBtn");
const avatarButton = document.getElementById("avatarButton");
const avatarDropdown = document.getElementById("avatarDropdown");
const typeModal = document.getElementById("typeModal");
const typeModalBody = document.getElementById("typeModalBody");
const typeModalClose = document.getElementById("typeModalClose");
const ticketPriceField = document.getElementById("ticketPriceField");
const feePerParticipantField = document.getElementById("feePerParticipantField");
const platformSection = document.getElementById("platformSection");
const platformRateLabel = document.getElementById("platformRateLabel");
const platformName = document.getElementById("platformName");
const platformCommission = document.getElementById("platformCommission");
const platformRequiresInvoice = document.getElementById("platformRequiresInvoice");
const platformEmail = document.getElementById("platformEmail");
const addPlatform = document.getElementById("addPlatform");
const platformsDraftList = document.getElementById("platformsDraftList");

let session = null;
let sharedGuideIds = new Set();
let sharedGuideProfiles = new Map();
let activeType = null;
let draftPlatforms = [];

function bindFocusScroll() {
  const fields = document.querySelectorAll(
    "#typeName, #ticketPrice, #platformName, #platformCommission, #platformEmail, #paymentType"
  );
  fields.forEach((field) => {
    field.addEventListener("focus", () => {
      window.setTimeout(() => {
        field.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 220);
    });
  });
}

function setStatus(message) {
  if (typeStatus) typeStatus.textContent = message || "";
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function normalizePlatform(platform) {
  return {
    id: platform.id || crypto.randomUUID(),
    name: String(platform.name || "").trim(),
    commission_percent: Number(platform.commission_percent || 0),
    requires_invoice: platform.requires_invoice !== false,
    email: String(platform.email || "").trim() || null,
    description: String(platform.description || "").trim() || null,
  };
}

function clonePlatforms(platforms) {
  return Array.isArray(platforms) ? platforms.map((platform) => normalizePlatform(platform)) : [];
}

function renderPlatformsList(target, platforms, onRemove, readOnly = false) {
  clearChildren(target);
  if (!platforms.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No platforms yet.";
    target.appendChild(empty);
    return;
  }

  platforms.forEach((platform, index) => {
    const row = document.createElement("div");
    row.className = "platform-row";

    const text = document.createElement("div");
    const invoiceLabel = platform.requires_invoice ? "invoice" : "no invoice";
    text.textContent = `${platform.name} · ${platform.commission_percent}% · ${invoiceLabel}`;
    row.appendChild(text);

    if (!readOnly && onRemove) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "ghost";
      removeBtn.textContent = "Delete";
      removeBtn.addEventListener("click", () => onRemove(index));
      row.appendChild(removeBtn);
    }

    target.appendChild(row);
  });
}

function clearPlatformDraftInputs() {
  platformName.value = "";
  platformCommission.value = "";
  platformRequiresInvoice.checked = true;
  platformEmail.value = "";
}

function addDraftPlatform() {
  const name = platformName.value.trim();
  const commissionValue = Number(platformCommission.value || "");
  if (!name) {
    setStatus("Platform name is required.");
    return;
  }
  if (!Number.isFinite(commissionValue) || commissionValue < 0) {
    setStatus("Platform commission must be a valid number.");
    return;
  }
  draftPlatforms.push(normalizePlatform({
    name,
    commission_percent: commissionValue,
    requires_invoice: platformRequiresInvoice.checked,
    email: platformEmail.value,
    description: null,
  }));
  clearPlatformDraftInputs();
  renderDraftPlatforms();
  setStatus("Platform added.");
}

function renderDraftPlatforms() {
  renderPlatformsList(platformsDraftList, draftPlatforms, (index) => {
    draftPlatforms.splice(index, 1);
    renderDraftPlatforms();
  });
}

function applyNewTypeVisibility() {
  const isFree = paymentType.value === "free";
  ticketPriceField.style.display = isFree ? "none" : "";
  feePerParticipantField.style.display = "none";
  platformSection.style.display = "";
  if (platformRateLabel) {
    platformRateLabel.textContent = isFree ? "Fee per participant" : "Commission %";
  }
  platformCommission.placeholder = isFree ? "Fee per participant" : "Commission %";
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
  avatarDropdown?.querySelector('a[href="share.html"]')
    ?.classList.toggle("has-pending-dot", hasPending);
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
    profiles.forEach((profile) => sharedGuideProfiles.set(profile.id, profile));
  }
}

function closeTypeModal() {
  if (!typeModal || !typeModalBody) return;
  typeModal.classList.remove("open");
  typeModal.setAttribute("aria-hidden", "true");
  activeType = null;
}

function openTypeModal(type) {
  if (!typeModal || !typeModalBody) return;
  activeType = type;
  typeModal.classList.add("open");
  typeModal.setAttribute("aria-hidden", "false");
  renderTypeModal(type);
}

function buildModalPlatformSection(platforms, isOwner) {
  const wrapper = document.createElement("div");
  wrapper.className = "details-content";

  const list = document.createElement("div");
  list.className = "platform-list";

  const refresh = () => {
    renderPlatformsList(list, platforms, (index) => {
      platforms.splice(index, 1);
      refresh();
    }, !isOwner);
  };
  refresh();
  wrapper.appendChild(list);

  if (!isOwner) return { wrapper, refresh };

  const form = document.createElement("div");
  form.className = "form-col compact-two-col";

  const makeField = (labelText, inputEl) => {
    const label = document.createElement("label");
    label.className = `field${inputEl.type === "checkbox" ? " checkbox-field" : ""}`;
    const span = document.createElement("span");
    span.textContent = labelText;
    label.appendChild(span);
    label.appendChild(inputEl);
    return label;
  };

  const nameInput = document.createElement("input");
  nameInput.className = "input";
  nameInput.type = "text";
  nameInput.placeholder = "Platform name";

  const commissionInput = document.createElement("input");
  commissionInput.className = "input";
  commissionInput.type = "number";
  commissionInput.step = "0.01";
  commissionInput.placeholder = "Commission %";

  const invoiceInput = document.createElement("input");
  invoiceInput.className = "checkbox";
  invoiceInput.type = "checkbox";
  invoiceInput.checked = true;

  const emailInput = document.createElement("input");
  emailInput.className = "input";
  emailInput.type = "text";
  emailInput.placeholder = "Email (optional)";

  const rateField = document.createElement("label");
  rateField.className = "field";
  const rateLabel = document.createElement("span");
  rateLabel.className = "platform-rate-label";
  rateLabel.textContent = "Commission %";
  rateField.appendChild(rateLabel);
  rateField.appendChild(commissionInput);

  form.appendChild(makeField("Platform name", nameInput));
  form.appendChild(rateField);
  form.appendChild(makeField("Invoice required", invoiceInput));
  form.appendChild(makeField("Email", emailInput));
  wrapper.appendChild(form);

  const actions = document.createElement("div");
  actions.className = "form-row";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "ghost";
  addBtn.textContent = "Add platform";
  addBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    const commissionValue = Number(commissionInput.value || "");
    if (!name) {
      setStatus("Platform name is required.");
      return;
    }
    if (!Number.isFinite(commissionValue) || commissionValue < 0) {
      setStatus("Platform commission must be a valid number.");
      return;
    }
    platforms.push(normalizePlatform({
      name,
      commission_percent: commissionValue,
      requires_invoice: invoiceInput.checked,
      email: emailInput.value,
      description: null,
    }));
    nameInput.value = "";
    commissionInput.value = "";
    invoiceInput.checked = true;
    emailInput.value = "";
    refresh();
  });
  actions.appendChild(addBtn);
  wrapper.appendChild(actions);

  return { wrapper, refresh };
}

function renderTypeModal(type) {
  clearChildren(typeModalBody);
  const isOwner = type.guide_id === session.user.id;
  const platforms = clonePlatforms(type.platforms);

  const form = document.createElement("div");
  form.className = "form-col compact-two-col";

  const makeField = (labelText, inputEl) => {
    const label = document.createElement("label");
    label.className = `field${inputEl.type === "checkbox" ? " checkbox-field" : ""}`;
    const span = document.createElement("span");
    span.textContent = labelText;
    label.appendChild(span);
    label.appendChild(inputEl);
    return label;
  };

  const paymentSelect = document.createElement("select");
  paymentSelect.className = "select";
  [
    { value: "prepaid", label: "Pre-paid" },
    { value: "free", label: "Free tour" },
  ].forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    if ((type.payment_type || "prepaid") === item.value) option.selected = true;
    paymentSelect.appendChild(option);
  });

  const shareableInput = document.createElement("input");
  shareableInput.className = "checkbox";
  shareableInput.type = "checkbox";
  shareableInput.checked = type.shareable !== false;

  const nameInput = document.createElement("input");
  nameInput.className = "input";
  nameInput.value = type.name || "";

  const priceInput = document.createElement("input");
  priceInput.className = "input";
  priceInput.type = "number";
  priceInput.step = "0.01";
  priceInput.value = type.ticket_price ?? "";

  [paymentSelect, shareableInput, nameInput, priceInput].forEach((el) => {
    el.disabled = !isOwner;
  });

  const priceWrap = makeField("Ticket price", priceInput);
  const platformTitle = document.createElement("div");
  platformTitle.className = "details-title strong-title modal-section-title";
  platformTitle.textContent = "Platforms";
  const { wrapper: platformWrapper } = buildModalPlatformSection(platforms, isOwner);
  const modalRateLabel = platformWrapper.querySelector(".platform-rate-label");
  const modalRateInput = platformWrapper.querySelector('input[type="number"]');

  const applyVisibility = () => {
    const isFree = paymentSelect.value === "free";
    priceWrap.style.display = isFree ? "none" : "";
    platformTitle.style.display = "";
    platformWrapper.style.display = "";
    if (modalRateLabel) {
      modalRateLabel.textContent = isFree ? "Fee per participant" : "Commission %";
    }
    if (modalRateInput) {
      modalRateInput.placeholder = isFree ? "Fee per participant" : "Commission %";
    }
  };
  paymentSelect.addEventListener("change", applyVisibility);

  form.appendChild(makeField("Payment type", paymentSelect));
  form.appendChild(makeField("Shareable", shareableInput));
  form.appendChild(makeField("Tour name", nameInput));
  form.appendChild(priceWrap);
  typeModalBody.appendChild(form);
  typeModalBody.appendChild(platformTitle);
  typeModalBody.appendChild(platformWrapper);
  applyVisibility();

  const actions = document.createElement("div");
  actions.className = "form-row";

  const saveBtn = document.createElement("button");
  saveBtn.className = "primary";
  saveBtn.type = "button";
  saveBtn.textContent = "Save";
  saveBtn.disabled = !isOwner;
  saveBtn.addEventListener("click", async () => {
    if (!isOwner) return;
    const name = nameInput.value.trim();
    const isFree = paymentSelect.value === "free";
    if (!name) {
      setStatus("Tour name is required.");
      return;
    }
    if (isFree) {
      if (!platforms.length) {
        setStatus("Add at least one platform for a free tour.");
        return;
      }
    } else {
      if (priceInput.value === "") {
        setStatus("Ticket price is required for pre-paid tours.");
        return;
      }
      if (!platforms.length) {
        setStatus("Add at least one platform for a pre-paid tour.");
        return;
      }
    }

    const { data: existingType, error: existingTypeError } = await supabase
      .from("tour_types")
      .select("id")
      .eq("guide_id", type.guide_id)
      .ilike("name", name)
      .neq("id", type.id)
      .maybeSingle();
    if (existingTypeError) {
      setStatus(`Check error: ${existingTypeError.message}`);
      return;
    }
    if (existingType) {
      setStatus("You already have a tour type with this name.");
      return;
    }

    const oldName = type.name;
    const prevShareable = type.shareable !== false;
    const payload = {
      payment_type: paymentSelect.value,
      shareable: shareableInput.checked,
      name,
      description: type.description || null,
      ticket_price: isFree ? null : Number(priceInput.value),
      fee_per_participant: null,
      platforms,
      commission_percent: null,
      invoice_org_name: null,
      invoice_org_address: null,
    };

    const { error: updateError } = await supabase
      .from("tour_types")
      .update(payload)
      .eq("id", type.id);
    if (updateError) {
      setStatus(`Save error: ${updateError.message}`);
      return;
    }

    const toursUpdate = {};
    if (oldName !== name) toursUpdate.type = name;
    if (prevShareable !== shareableInput.checked) {
      toursUpdate.is_private = shareableInput.checked ? false : true;
    }
    if (Object.keys(toursUpdate).length > 0) {
      await supabase
        .from("tours")
        .update(toursUpdate)
        .eq("guide_id", type.guide_id)
        .eq("type", oldName);
    }

    setStatus("Saved.");
    await loadTypes();
    closeTypeModal();
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "ghost";
  deleteBtn.type = "button";
  deleteBtn.textContent = "Delete";
  deleteBtn.disabled = !isOwner;
  deleteBtn.addEventListener("click", async () => {
    if (!isOwner) return;
    if (!confirm("Delete this tour type?")) return;
    const { error } = await supabase.from("tour_types").delete().eq("id", type.id);
    if (error) {
      setStatus(`Delete error: ${error.message}`);
      return;
    }
    setStatus("Deleted.");
    await loadTypes();
    closeTypeModal();
  });

  actions.appendChild(saveBtn);
  actions.appendChild(deleteBtn);
  typeModalBody.appendChild(actions);
}

async function loadTypes() {
  clearChildren(typesList);
  if (!session) return;

  const { data, error } = await supabase
    .from("tour_types")
    .select("id,guide_id,name,description,ticket_price,payment_type,fee_per_participant,shareable,platforms")
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
    const platformCount = Array.isArray(type.platforms) ? type.platforms.length : 0;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tour-row accepted";
    row.textContent = `${type.name} · ${ownerName}${type.payment_type === "prepaid" ? ` · ${platformCount} platform${platformCount === 1 ? "" : "s"}` : " · Free tour"}`;
    row.addEventListener("click", () => openTypeModal(type));
    typesList.appendChild(row);
  });
}

async function addNewType() {
  if (!session) return;
  const name = typeName.value.trim();
  const isFree = paymentType.value === "free";

  if (!name) {
    setStatus("Tour name is required.");
    return;
  }
  if (!isFree && ticketPrice.value === "") {
    setStatus("Ticket price is required for pre-paid tours.");
    return;
  }
  if (!draftPlatforms.length) {
    setStatus(`Add at least one platform for a ${isFree ? "free" : "pre-paid"} tour.`);
    return;
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
    description: null,
    ticket_price: isFree ? null : Number(ticketPrice.value),
    fee_per_participant: null,
    platforms: draftPlatforms,
    commission_percent: null,
    invoice_org_name: null,
    invoice_org_address: null,
  });
  if (error) {
    setStatus(`Add error: ${error.message}`);
    return;
  }

  setStatus("Type added.");
  paymentType.value = "prepaid";
  if (typeShareable) typeShareable.checked = true;
  typeName.value = "";
  ticketPrice.value = "";
  feePerParticipant.value = "";
  draftPlatforms = [];
  clearPlatformDraftInputs();
  renderDraftPlatforms();
  applyNewTypeVisibility();
  await loadTypes();
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
  renderDraftPlatforms();
  applyNewTypeVisibility();
  bindFocusScroll();
  await loadTypes();
}

if (addPlatform) addPlatform.addEventListener("click", addDraftPlatform);
if (addType) addType.addEventListener("click", addNewType);
if (paymentType) paymentType.addEventListener("change", applyNewTypeVisibility);

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
