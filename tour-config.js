import { createClient } from "./supabase-client.js";
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
const platformDefaultPrice = document.getElementById("platformDefaultPrice");
const platformCommission = document.getElementById("platformCommission");
const platformRequiresInvoice = document.getElementById("platformRequiresInvoice");
const platformEmail = document.getElementById("platformEmail");
const addPlatform = document.getElementById("addPlatform");
const platformsDraftList = document.getElementById("platformsDraftList");
const templateEndDate = document.getElementById("templateEndDate");
const templateWeekday = document.getElementById("templateWeekday");
const templateTime = document.getElementById("templateTime");
const addTemplate = document.getElementById("addTemplate");
const templatesDraftList = document.getElementById("templatesDraftList");

let session = null;
let sharedGuideIds = new Set();
let sharedGuideProfiles = new Map();
let activeType = null;
let typeModalIsDirty = () => false;
let draftPlatforms = [];
let draftTemplates = [];

const weekdayOptions = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

function bindFocusScroll() {
  const fields = document.querySelectorAll(
    "#typeName, #ticketPrice, #platformName, #platformDefaultPrice, #platformCommission, #platformEmail, #paymentType, #templateEndDate, #templateWeekday, #templateTime"
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

function makeId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function normalizePlatform(platform) {
  return {
    id: platform.id || makeId(),
    name: String(platform.name || "").trim(),
    default_price: platform.default_price == null || platform.default_price === ""
      ? null
      : Number(platform.default_price),
    commission_percent: Number(platform.commission_percent || 0),
    requires_invoice: platform.requires_invoice !== false,
    email: String(platform.email || "").trim() || null,
    description: String(platform.description || "").trim() || null,
  };
}

function clonePlatforms(platforms, fallbackDefaultPrice = null) {
  return Array.isArray(platforms)
    ? platforms.map((platform) => normalizePlatform({
        ...platform,
        default_price: platform.default_price == null
          ? (fallbackDefaultPrice ?? platform.commission_percent ?? null)
          : platform.default_price,
      }))
    : [];
}

function normalizeTemplate(template) {
  return {
    id: template.id || makeId(),
    weekday: Number(template.weekday),
    start_time: String(template.start_time || "").slice(0, 5),
  };
}

function cloneTemplates(templates) {
  return Array.isArray(templates) ? templates.map((template) => normalizeTemplate(template)) : [];
}

function formatTemplateLabel(template) {
  const weekdayLabel = weekdayOptions.find((option) => option.value === Number(template.weekday))?.label || "Day";
  return `${weekdayLabel} · ${template.start_time}`;
}

function addMinutesToTime(value, minutesToAdd) {
  const [h, m] = String(value || "").split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return "";
  const total = h * 60 + m + minutesToAdd;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

function getTypePricePerPerson(typeRecord, platform) {
  if (!typeRecord) return 0;
  if (platform && platform.default_price != null && platform.default_price !== "") {
    return Number(platform.default_price || 0);
  }
  if (typeRecord.payment_type === "free") {
    return Number(platform?.commission_percent ?? typeRecord.fee_per_participant ?? 0);
  }
  return Number(typeRecord.ticket_price ?? 0);
}

function getTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function populateWeekdaySelect(select) {
  if (!select || select.childElementCount > 0) return;
  weekdayOptions.forEach((optionData) => {
    const option = document.createElement("option");
    option.value = String(optionData.value);
    option.textContent = optionData.label;
    select.appendChild(option);
  });
}

function populateTimeSelect(select) {
  if (!select || select.childElementCount > 0) return;
  for (let hour = 9; hour <= 18; hour += 1) {
    for (let minute = 0; minute < 60; minute += 30) {
      if (hour === 18 && minute > 0) continue;
      const option = document.createElement("option");
      const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
  }
}

function renderPlatformsList(target, platforms, onRemove, readOnly = false, onUpdate = null) {
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
    text.textContent = `${platform.name} · default GBP ${Number(platform.default_price || 0).toFixed(2)} · ${platform.commission_percent}% · ${invoiceLabel}`;
    row.appendChild(text);

    if (!readOnly) {
      if (onUpdate) {
        const priceInput = document.createElement("input");
        priceInput.type = "number";
        priceInput.step = "0.01";
        priceInput.min = "0";
        priceInput.className = "input platform-inline-price";
        priceInput.value = platform.default_price == null ? "" : String(platform.default_price);
        priceInput.addEventListener("change", () => {
          onUpdate(index, {
            ...platform,
            default_price: priceInput.value === "" ? null : Number(priceInput.value),
          });
        });
        row.appendChild(priceInput);
      }
    }

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

function renderTemplatesList(target, templates, onRemove, readOnly = false) {
  clearChildren(target);
  if (!templates.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No templates yet.";
    target.appendChild(empty);
    return;
  }

  templates.forEach((template, index) => {
    const row = document.createElement("div");
    row.className = "platform-row";

    const text = document.createElement("div");
    text.textContent = formatTemplateLabel(template);
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
  platformDefaultPrice.value = "";
  platformCommission.value = "";
  platformRequiresInvoice.checked = true;
  platformEmail.value = "";
}

function clearTemplateDraftInputs() {
  if (templateWeekday) templateWeekday.selectedIndex = 0;
  if (templateTime) templateTime.selectedIndex = 0;
}

function addDraftPlatform() {
  const name = platformName.value.trim();
  const defaultPriceValue = Number(platformDefaultPrice.value || "");
  const commissionValue = Number(platformCommission.value || "");
  if (!name) {
    setStatus("Platform name is required.");
    return;
  }
  if (!Number.isFinite(defaultPriceValue) || defaultPriceValue < 0) {
    setStatus("Platform default price must be a valid number.");
    return;
  }
  if (!Number.isFinite(commissionValue) || commissionValue < 0) {
    setStatus("Platform commission must be a valid number.");
    return;
  }
  draftPlatforms.push(normalizePlatform({
    name,
    default_price: defaultPriceValue,
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
  }, false, (index, nextPlatform) => {
    draftPlatforms[index] = normalizePlatform(nextPlatform);
    renderDraftPlatforms();
  });
}

function renderDraftTemplates() {
  renderTemplatesList(templatesDraftList, draftTemplates, (index) => {
    draftTemplates.splice(index, 1);
    renderDraftTemplates();
  });
}

function addDraftTemplate() {
  const weekday = Number(templateWeekday?.value ?? "");
  const startTime = templateTime?.value || "";
  if (!templateEndDate?.value) {
    setStatus("Template end date is required.");
    return;
  }
  if (!startTime || Number.isNaN(weekday)) {
    setStatus("Template day and hour are required.");
    return;
  }
  if (draftTemplates.some((template) => template.weekday === weekday && template.start_time === startTime)) {
    setStatus("This schedule template already exists.");
    return;
  }
  draftTemplates.push(normalizeTemplate({ weekday, start_time: startTime }));
  clearTemplateDraftInputs();
  renderDraftTemplates();
  setStatus("Schedule template added.");
}

function applyNewTypeVisibility() {
  const isFree = paymentType.value === "free";
  ticketPriceField.style.display = "none";
  feePerParticipantField.style.display = "none";
  platformSection.style.display = "";
  if (platformRateLabel) {
    platformRateLabel.textContent = isFree ? "Fee per participant" : "Commission %";
  }
  if (platformDefaultPrice) {
    platformDefaultPrice.placeholder = isFree ? "Default fee" : "Default price";
  }
  platformCommission.placeholder = isFree ? "Fee per participant" : "Commission %";
}

function buildScheduledTours(typeRecord) {
  const templates = cloneTemplates(typeRecord.schedule_templates);
  const endDate = typeRecord.template_end_date;
  if (!templates.length || !endDate) return [];

  const todayIso = getTodayISO();
  const startDate = new Date(`${todayIso}T00:00:00`);
  const lastDate = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(lastDate.getTime()) || lastDate < startDate) return [];

  const generated = [];
  for (let cursor = new Date(startDate); cursor <= lastDate; cursor.setDate(cursor.getDate() + 1)) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    templates.forEach((template) => {
      if (cursor.getDay() !== Number(template.weekday)) return;
      generated.push({
        source_template_id: template.id,
        date: iso,
        start_time: template.start_time,
        end_time: addMinutesToTime(template.start_time, 90),
      });
    });
  }
  return generated;
}

function scheduledTourKey(tour) {
  return `${tour.date}|${String(tour.start_time || "").slice(0, 5)}|${String(tour.end_time || "").slice(0, 5)}`;
}

async function syncScheduledTours(typeRecord) {
  const todayIso = getTodayISO();
  const desiredTours = buildScheduledTours(typeRecord);

  const { data: existingGenerated, error: generatedError } = await supabase
    .from("tours")
    .select("id,date,start_time,end_time,source_template_id")
    .eq("source_tour_type_id", typeRecord.id)
    .gte("date", todayIso);
  if (generatedError) {
    throw new Error(`Template sync load error: ${generatedError.message}`);
  }

  const generatedByKey = new Map(
    (existingGenerated || []).map((tour) => [scheduledTourKey(tour), tour])
  );

  if (!desiredTours.length) return;

  const minDate = desiredTours[0].date;
  const maxDate = desiredTours[desiredTours.length - 1].date;
  const { data: allTours, error: allToursError } = await supabase
    .from("tours")
    .select("id,date,start_time,end_time,source_tour_type_id,source_template_id")
    .eq("guide_id", typeRecord.guide_id)
    .gte("date", minDate)
    .lte("date", maxDate);
  if (allToursError) {
    throw new Error(`Template sync conflict error: ${allToursError.message}`);
  }

  const occupiedSlots = new Set(
    (allTours || [])
      .filter((tour) => tour.source_tour_type_id !== typeRecord.id)
      .map((tour) => scheduledTourKey(tour))
  );

  const inserts = desiredTours
    .filter((tour) => !generatedByKey.has(scheduledTourKey(tour)))
    .filter((tour) => !occupiedSlots.has(scheduledTourKey(tour)))
    .map((tour) => ({
      guide_id: typeRecord.guide_id,
      created_by: typeRecord.guide_id,
      status: "accepted",
      date: tour.date,
      start_time: tour.start_time,
      end_time: tour.end_time,
      type: typeRecord.name,
      is_private: typeRecord.shareable === false,
      platform: Array.isArray(typeRecord.platforms) && typeRecord.platforms.length ? typeRecord.platforms[0] : null,
      price_per_person: getTypePricePerPerson(typeRecord, Array.isArray(typeRecord.platforms) && typeRecord.platforms.length ? typeRecord.platforms[0] : null),
      source_tour_type_id: typeRecord.id,
      source_template_id: tour.source_template_id,
    }));

  if (inserts.length) {
    const { error: insertError } = await supabase.from("tours").insert(inserts);
    if (insertError) {
      throw new Error(`Template sync insert error: ${insertError.message}`);
    }
  }

  const updates = desiredTours
    .map((tour) => {
      const existing = generatedByKey.get(scheduledTourKey(tour));
      if (!existing) return null;
      const nextPlatform = Array.isArray(typeRecord.platforms) && typeRecord.platforms.length ? typeRecord.platforms[0] : null;
      return {
        id: existing.id,
        type: typeRecord.name,
        is_private: typeRecord.shareable === false,
        platform: nextPlatform,
        price_per_person: getTypePricePerPerson(typeRecord, nextPlatform),
        start_time: tour.start_time,
        end_time: tour.end_time,
      };
    })
    .filter(Boolean);

  for (const updateRow of updates) {
    const { id, ...payload } = updateRow;
    const { error: updateError } = await supabase
      .from("tours")
      .update(payload)
      .eq("id", id);
    if (updateError) {
      throw new Error(`Template sync update error: ${updateError.message}`);
    }
  }
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

function closeTypeModal(force = false) {
  if (!typeModal || !typeModalBody) return;
  if (!force && typeModalIsDirty()) {
    const confirmed = confirm("Ignore your unsaved changes?");
    if (!confirmed) return;
  }
  typeModal.classList.remove("open");
  typeModal.setAttribute("aria-hidden", "true");
  activeType = null;
  typeModalIsDirty = () => false;
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
    }, !isOwner, (index, nextPlatform) => {
      platforms[index] = normalizePlatform(nextPlatform);
      refresh();
    });
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

  const defaultPriceInput = document.createElement("input");
  defaultPriceInput.className = "input";
  defaultPriceInput.type = "number";
  defaultPriceInput.step = "0.01";
  defaultPriceInput.placeholder = "Default price";

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
  form.appendChild(makeField("Default price", defaultPriceInput));
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
    const defaultPriceValue = Number(defaultPriceInput.value || "");
    const commissionValue = Number(commissionInput.value || "");
    if (!name) {
      setStatus("Platform name is required.");
      return;
    }
    if (!Number.isFinite(defaultPriceValue) || defaultPriceValue < 0) {
      setStatus("Platform default price must be a valid number.");
      return;
    }
    if (!Number.isFinite(commissionValue) || commissionValue < 0) {
      setStatus("Platform commission must be a valid number.");
      return;
    }
    platforms.push(normalizePlatform({
      name,
      default_price: defaultPriceValue,
      commission_percent: commissionValue,
      requires_invoice: invoiceInput.checked,
      email: emailInput.value,
      description: null,
    }));
    nameInput.value = "";
    defaultPriceInput.value = "";
    commissionInput.value = "";
    invoiceInput.checked = true;
    emailInput.value = "";
    refresh();
  });
  actions.appendChild(addBtn);
  wrapper.appendChild(actions);

  return { wrapper, refresh };
}

function buildModalTemplateSection(templates, endDateValue, isOwner) {
  const wrapper = document.createElement("div");
  wrapper.className = "details-content";

  const endDateField = document.createElement("label");
  endDateField.className = "field";
  const endDateLabel = document.createElement("span");
  endDateLabel.textContent = "End date";
  const endDateInput = document.createElement("input");
  endDateInput.className = "input";
  endDateInput.type = "date";
  endDateInput.value = endDateValue || "";
  endDateInput.disabled = !isOwner;
  endDateField.appendChild(endDateLabel);
  endDateField.appendChild(endDateInput);
  wrapper.appendChild(endDateField);

  const list = document.createElement("div");
  list.className = "platform-list";
  const refresh = () => {
    renderTemplatesList(list, templates, (index) => {
      templates.splice(index, 1);
      refresh();
    }, !isOwner);
  };
  refresh();
  wrapper.appendChild(list);

  if (!isOwner) return { wrapper, endDateInput };

  const form = document.createElement("div");
  form.className = "form-col compact-two-col";

  const weekdaySelect = document.createElement("select");
  weekdaySelect.className = "select";
  populateWeekdaySelect(weekdaySelect);

  const timeSelect = document.createElement("select");
  timeSelect.className = "select";
  populateTimeSelect(timeSelect);

  const makeField = (labelText, inputEl) => {
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.textContent = labelText;
    label.appendChild(span);
    label.appendChild(inputEl);
    return label;
  };

  form.appendChild(makeField("Day", weekdaySelect));
  form.appendChild(makeField("Hour", timeSelect));
  wrapper.appendChild(form);

  const actions = document.createElement("div");
  actions.className = "form-row";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "ghost";
  addBtn.textContent = "Add template";
  addBtn.addEventListener("click", () => {
    if (!endDateInput.value) {
      setStatus("Template end date is required.");
      return;
    }
    const weekday = Number(weekdaySelect.value);
    const startTime = timeSelect.value || "";
    if (templates.some((template) => template.weekday === weekday && template.start_time === startTime)) {
      setStatus("This schedule template already exists.");
      return;
    }
    templates.push(normalizeTemplate({ weekday, start_time: startTime }));
    refresh();
  });
  actions.appendChild(addBtn);
  wrapper.appendChild(actions);

  return { wrapper, endDateInput };
}

function renderTypeModal(type) {
  clearChildren(typeModalBody);
  const isOwner = type.guide_id === session.user.id;
  const legacyDefaultPrice = type.payment_type === "free"
    ? type.fee_per_participant
    : type.ticket_price;
  const platforms = clonePlatforms(type.platforms, legacyDefaultPrice);
  const templates = cloneTemplates(type.schedule_templates);
  const buildSnapshot = () => JSON.stringify({
    payment_type: paymentSelect.value,
    shareable: shareableInput.checked,
    name: nameInput.value.trim(),
    ticket_price: getTypePricePerPerson({ payment_type: paymentSelect.value, ticket_price: priceInput.value }, platforms[0] || null),
    platforms,
    schedule_templates: templates,
    template_end_date: modalTemplateEndDate?.value || null,
  });

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
  const templateTitle = document.createElement("div");
  templateTitle.className = "details-title strong-title modal-section-title";
  templateTitle.textContent = "Schedule Template";
  const { wrapper: templateWrapper, endDateInput: modalTemplateEndDate } = buildModalTemplateSection(
    templates,
    type.template_end_date,
    isOwner
  );
  const modalRateLabel = platformWrapper.querySelector(".platform-rate-label");
  const modalRateInput = platformWrapper.querySelector('input[type="number"]');

  const applyVisibility = () => {
    const isFree = paymentSelect.value === "free";
    priceWrap.style.display = "none";
    platformTitle.style.display = "";
    platformWrapper.style.display = "";
    if (modalRateLabel) {
      modalRateLabel.textContent = isFree ? "Fee per participant" : "Commission %";
    }
    if (modalRateInput) {
      modalRateInput.placeholder = isFree ? "Fee per participant" : "Commission %";
    }
    const modalDefaultPriceInputs = platformWrapper.querySelectorAll(".platform-inline-price");
    modalDefaultPriceInputs.forEach((input) => {
      input.placeholder = isFree ? "Default fee" : "Default price";
    });
  };
  paymentSelect.addEventListener("change", applyVisibility);

  form.appendChild(makeField("Payment type", paymentSelect));
  form.appendChild(makeField("Shareable", shareableInput));
  form.appendChild(makeField("Tour name", nameInput));
  form.appendChild(priceWrap);
  typeModalBody.appendChild(form);
  typeModalBody.appendChild(platformTitle);
  typeModalBody.appendChild(platformWrapper);
  typeModalBody.appendChild(templateTitle);
  typeModalBody.appendChild(templateWrapper);
  applyVisibility();

  const initialSnapshot = buildSnapshot();
  typeModalIsDirty = () => isOwner && buildSnapshot() !== initialSnapshot;

  const closeBtn = document.createElement("button");
  closeBtn.className = "ghost";
  closeBtn.type = "button";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => closeTypeModal());

  if (isOwner) {
    const actions = document.createElement("div");
    actions.className = "form-row";

    const saveBtn = document.createElement("button");
    saveBtn.className = "primary";
    saveBtn.type = "button";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
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
      if (!platforms.length) {
        setStatus("Add at least one platform for a pre-paid tour.");
        return;
      }
    }
    if (templates.length && !modalTemplateEndDate?.value) {
      setStatus("Template end date is required.");
      return;
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
      ticket_price: isFree
        ? null
        : getTypePricePerPerson({ payment_type: paymentSelect.value, ticket_price: priceInput.value }, platforms[0] || null),
      fee_per_participant: null,
      platforms,
      schedule_templates: templates,
      template_end_date: modalTemplateEndDate?.value || null,
      commission_percent: null,
      invoice_org_name: null,
      invoice_org_address: null,
    };

    const nextTypeState = {
      ...type,
      ...payload,
      id: type.id,
      guide_id: type.guide_id,
    };

    const { error: updateError } = await supabase
      .from("tour_types")
      .update(payload)
      .eq("id", type.id);
    if (updateError) {
      setStatus(`Save error: ${updateError.message}`);
      return;
    }

    try {
      await syncScheduledTours({
        ...type,
        ...payload,
        id: type.id,
        guide_id: type.guide_id,
      });
    } catch (syncError) {
      setStatus(syncError.message);
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

    const nextPlatform = Array.isArray(platforms) && platforms.length ? platforms[0] : null;
    const futureToursPayload = {
      type: name,
      is_private: shareableInput.checked ? false : true,
      platform: nextPlatform,
      price_per_person: getTypePricePerPerson({ ...type, ...payload }, nextPlatform),
    };

    await supabase
      .from("tours")
      .update(futureToursPayload)
      .eq("source_tour_type_id", type.id)
      .gte("date", getTodayISO());

    await supabase
      .from("tours")
      .update(futureToursPayload)
      .eq("guide_id", type.guide_id)
      .eq("type", oldName)
      .is("source_tour_type_id", null)
      .gte("date", getTodayISO());

    setStatus("Saved.");
    await loadTypes();
    closeTypeModal(true);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ghost";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      if (!confirm("Delete this tour type?")) return;
      const todayIso = getTodayISO();
      await supabase
        .from("tours")
        .delete()
        .eq("source_tour_type_id", type.id)
        .gte("date", todayIso);
      const { error } = await supabase.from("tour_types").delete().eq("id", type.id);
      if (error) {
        setStatus(`Delete error: ${error.message}`);
        return;
      }
      setStatus("Deleted.");
      await loadTypes();
      closeTypeModal(true);
    });

    actions.appendChild(closeBtn);
    actions.appendChild(saveBtn);
    actions.appendChild(deleteBtn);
    typeModalBody.appendChild(actions);
    return;
  }

  const actions = document.createElement("div");
  actions.className = "form-row";
  actions.appendChild(closeBtn);
  typeModalBody.appendChild(actions);
}

async function loadTypes() {
  clearChildren(typesList);
  if (!session) return;

  const { data, error } = await supabase
    .from("tour_types")
    .select("id,guide_id,name,description,ticket_price,payment_type,fee_per_participant,shareable,platforms,schedule_templates,template_end_date")
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
    const templateCount = Array.isArray(type.schedule_templates) ? type.schedule_templates.length : 0;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tour-row accepted";
    row.textContent = `${type.name} · ${ownerName} · ${platformCount} platform${platformCount === 1 ? "" : "s"} · ${templateCount} template${templateCount === 1 ? "" : "s"}`;
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
  if (!draftPlatforms.length) {
    setStatus(`Add at least one platform for a ${isFree ? "free" : "pre-paid"} tour.`);
    return;
  }
  if (draftTemplates.length && !templateEndDate.value) {
    setStatus("Template end date is required.");
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

  const { data: insertedType, error } = await supabase.from("tour_types").insert({
    guide_id: session.user.id,
    payment_type: paymentType.value,
    shareable: typeShareable ? typeShareable.checked : true,
    name,
    description: null,
    ticket_price: isFree
      ? null
      : getTypePricePerPerson({ payment_type: paymentType.value, ticket_price: ticketPrice.value }, draftPlatforms[0] || null),
    fee_per_participant: null,
    platforms: draftPlatforms,
    schedule_templates: draftTemplates,
    template_end_date: templateEndDate.value || null,
    commission_percent: null,
    invoice_org_name: null,
    invoice_org_address: null,
  }).select("id,guide_id,name,shareable,payment_type,platforms,schedule_templates,template_end_date").single();
  if (error) {
    setStatus(`Add error: ${error.message}`);
    return;
  }

  try {
    await syncScheduledTours(insertedType);
  } catch (syncError) {
    setStatus(syncError.message);
    return;
  }

  setStatus("Type added.");
  paymentType.value = "prepaid";
  if (typeShareable) typeShareable.checked = true;
  typeName.value = "";
  ticketPrice.value = "";
  feePerParticipant.value = "";
  draftPlatforms = [];
  draftTemplates = [];
  clearPlatformDraftInputs();
  clearTemplateDraftInputs();
  if (templateEndDate) templateEndDate.value = "";
  renderDraftPlatforms();
  renderDraftTemplates();
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
  populateWeekdaySelect(templateWeekday);
  populateTimeSelect(templateTime);
  renderDraftPlatforms();
  renderDraftTemplates();
  applyNewTypeVisibility();
  bindFocusScroll();
  await loadTypes();
}

if (addPlatform) addPlatform.addEventListener("click", addDraftPlatform);
if (addTemplate) addTemplate.addEventListener("click", addDraftTemplate);
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

if (typeModal) {
  typeModal.addEventListener("click", (event) => {
    if (event.target && event.target.dataset && event.target.dataset.close === "true") return;
  });
}

init();
