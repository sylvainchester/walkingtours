import { createClient } from "./supabase-client.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const tourInfo = document.getElementById("tourInfo");
const participants = document.getElementById("participants");

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setInfo(message) {
  clearChildren(tourInfo);
  const el = document.createElement("div");
  el.textContent = message;
  tourInfo.appendChild(el);
}

function parseTime(value) {
  if (!value) return "";
  return value.slice(0, 5);
}

function formatParticipantMeta(participant, fallbackAmount) {
  const parts = [];
  const paidAmount = Number(participant?.paid_amount);
  const fallback = Number(fallbackAmount);
  const groupSize = Math.max(1, Number(participant?.group_size || 1));
  const effectiveAmount = Number.isFinite(paidAmount)
    ? paidAmount
    : (Number.isFinite(fallback) ? Number((fallback * groupSize).toFixed(2)) : null);
  if (effectiveAmount != null) parts.push(`paid GBP ${effectiveAmount.toFixed(2)}`);
  if (participant?.booked_at) parts.push(`booked ${participant.booked_at}`);
  return parts.join(" · ");
}

async function loadTour() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) {
    setInfo("Missing tour id.");
    return;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) {
    window.location.href = "sign-in.html";
    return;
  }

  const { data: tour, error } = await supabase
    .from("tours")
    .select("id,date,start_time,end_time,type,status,guide_id,created_by,price_per_person,participants(id,name,group_size,paid_amount,booked_at)")
    .eq("id", id)
    .maybeSingle();

  if (error || !tour) {
    setInfo("Tour not found or access denied.");
    return;
  }

  const { data: profiles } = await supabase
    .from("guide_profiles")
    .select("id,first_name,last_name")
    .eq("id", tour.guide_id)
    .maybeSingle();

  const guideName = profiles
    ? `${profiles.first_name} ${profiles.last_name}`
    : "Unknown";

  const infoCard = document.createElement("div");
  infoCard.className = `tour-row ${tour.status === "pending" ? "pending" : "accepted"}`;

  const infoText = document.createElement("div");
  infoText.textContent = `${parseTime(tour.start_time)} - ${parseTime(tour.end_time)} · ${guideName} · ${tour.type}`;

  infoCard.appendChild(infoText);
  clearChildren(tourInfo);
  tourInfo.appendChild(infoCard);

  const isOwner = tour.guide_id === session.user.id;
  const canEditParticipants = isOwner && tour.status === "accepted";

  if (tour.status === "pending" && isOwner) {
    const actions = document.createElement("div");
    actions.className = "form-row";

    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "primary";
    acceptBtn.textContent = "Accept";
    acceptBtn.addEventListener("click", async () => {
      const { error: acceptError } = await supabase
        .from("tours")
        .update({ status: "accepted" })
        .eq("id", tour.id);
      if (!acceptError) window.location.reload();
    });

    const declineBtn = document.createElement("button");
    declineBtn.type = "button";
    declineBtn.className = "ghost";
    declineBtn.textContent = "Decline";
    declineBtn.addEventListener("click", async () => {
      if (!confirm("Decline this tour? It will be removed.")) return;
      const { error: declineError } = await supabase
        .from("tours")
        .delete()
        .eq("id", tour.id);
      if (!declineError) window.location.href = "index.html";
    });

    actions.appendChild(acceptBtn);
    actions.appendChild(declineBtn);
    tourInfo.appendChild(actions);
  }

  renderParticipants(tour, canEditParticipants);
}

function renderParticipants(tour, canEdit) {
  clearChildren(participants);

  const list = document.createElement("div");
  list.className = "details-content";

  if (!tour.participants || tour.participants.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "No participants yet.";
    list.appendChild(empty);
  } else {
    tour.participants.forEach((p) => {
      const row = document.createElement("div");
      row.className = "participant";

      const name = document.createElement("div");
      name.textContent = `${p.name} (${p.group_size})${formatParticipantMeta(p, tour.price_per_person) ? ` · ${formatParticipantMeta(p, tour.price_per_person)}` : ""}`;

      row.appendChild(name);

      if (canEdit) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ghost";
        remove.textContent = "Remove";
        remove.addEventListener("click", async () => {
          const { error } = await supabase.from("participants").delete().eq("id", p.id);
          if (!error) window.location.reload();
        });
        row.appendChild(remove);
      }

      list.appendChild(row);
    });
  }

  if (canEdit) {
    const form = document.createElement("div");
    form.className = "form-row";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Participant name";
    nameInput.className = "input";

    const groupInput = document.createElement("input");
    groupInput.type = "number";
    groupInput.min = "1";
    groupInput.value = "1";
    groupInput.className = "input";

    const bookedAtInput = document.createElement("input");
    bookedAtInput.type = "date";
    bookedAtInput.className = "input";

    const paidAmountInput = document.createElement("input");
    paidAmountInput.type = "number";
    paidAmountInput.min = "0";
    paidAmountInput.step = "0.01";
    paidAmountInput.className = "input";
    paidAmountInput.value = tour.price_per_person == null ? "" : String(tour.price_per_person);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "primary";
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const groupSize = Number(groupInput.value || 1);
      if (!name) return;
      const unitAmount = paidAmountInput.value === "" ? null : Number(paidAmountInput.value);
      if (!Number.isFinite(unitAmount) || unitAmount < 0) {
        alert("Enter a price per person.");
        return;
      }
      const { error } = await supabase.from("participants").insert({
        tour_id: tour.id,
        name,
        group_size: groupSize,
        booked_at: bookedAtInput.value || null,
        paid_amount: Number((unitAmount * Math.max(1, Number(groupSize || 1))).toFixed(2)),
        creation_source: "manual",
      });
      if (!error) window.location.reload();
    });

    form.appendChild(nameInput);
    form.appendChild(groupInput);
    form.appendChild(bookedAtInput);
    form.appendChild(paidAmountInput);
    form.appendChild(addBtn);
    list.appendChild(form);
  }

  participants.appendChild(list);
}

loadTour();
