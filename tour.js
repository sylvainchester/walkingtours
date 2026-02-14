import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
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
    .select("id,date,start_time,end_time,type,status,guide_id,created_by,participants(id,name,group_size)")
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
      name.textContent = `${p.name} (${p.group_size})`;

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

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "primary";
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const groupSize = Number(groupInput.value || 1);
      if (!name) return;
      const { error } = await supabase.from("participants").insert({
        tour_id: tour.id,
        name,
        group_size: groupSize,
      });
      if (!error) window.location.reload();
    });

    form.appendChild(nameInput);
    form.appendChild(groupInput);
    form.appendChild(addBtn);
    list.appendChild(form);
  }

  participants.appendChild(list);
}

loadTour();
