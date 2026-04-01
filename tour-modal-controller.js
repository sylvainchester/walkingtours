export function createTourModalController(options) {
  let openTourId = null;
  let ocrBusy = false;

  const {
    supabase,
    sendPush,
    modal,
    modalBody,
    getSession,
    getSharedGuideIds,
    getSharedGuideProfiles,
    getShareValidationByGuideId,
    getTourTypes,
    findTourById,
    loadTourTypeForTour,
    getPlatformsForType,
    extractParticipantsFromImage,
    getTodayISO,
    formatShortDateNoYear,
    isPrivateForViewer,
    money,
    reloadData,
    pageUrl,
  } = options;

  function closeTourModal() {
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    openTourId = null;
  }

  function normalizeDateValue(value) {
    const direct = String(value || "").trim();
    if (!direct) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
    const parsed = new Date(direct);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
  }

  function normalizeAmountValue(value) {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
  }

  function getParticipantAmount(participant, fallbackAmount) {
    const direct = normalizeAmountValue(participant?.paid_amount);
    if (direct != null) return direct;
    const fallback = normalizeAmountValue(fallbackAmount);
    return fallback != null ? fallback : null;
  }

  function formatParticipantMeta(participant, fallbackAmount) {
    const parts = [];
    if (participant.platform_name) parts.push(participant.platform_name);
    const amount = getParticipantAmount(participant, fallbackAmount);
    if (amount != null) parts.push(`paid ${money(amount)}`);
    const bookedAt = normalizeDateValue(participant.booked_at);
    if (bookedAt) parts.push(`booked ${bookedAt}`);
    return parts.join(" · ");
  }

  function computeCollectedAmount(participants, fallbackAmount) {
    return (participants || [])
      .filter((participant) => participant.attendance_status === "arrived")
      .reduce((sum, participant) => {
        const amount = getParticipantAmount(participant, fallbackAmount);
        return sum + (Number(participant.group_size || 0) * Number(amount || 0));
      }, 0);
  }

  async function syncOpenTour() {
    if (!openTourId) return;
    const freshTour = findTourById(openTourId);
    if (freshTour) {
      await openTourModal(freshTour);
    } else {
      closeTourModal();
    }
  }

  async function saveTourGuideChange(tour, nextGuideId, currentGuideName) {
    const session = getSession();
    const shareValidationByGuideId = getShareValidationByGuideId();
    const sharedGuideProfiles = getSharedGuideProfiles();
    const validationRequired = nextGuideId === session.user.id
      ? false
      : (shareValidationByGuideId.get(nextGuideId) ?? true);
    const nextStatus = nextGuideId === session.user.id || !validationRequired ? "accepted" : "pending";

    const { data: conflicts, error: conflictError } = await supabase
      .from("tours")
      .select("id")
      .eq("guide_id", nextGuideId)
      .eq("date", tour.date)
      .neq("id", tour.id)
      .lte("start_time", tour.end_time)
      .gte("end_time", tour.start_time);
    if (conflictError) throw new Error(`Conflict check error: ${conflictError.message}`);
    if (conflicts && conflicts.length > 0) throw new Error("This guide already has another tour at the same time.");

    const previousGuideId = tour.guide_id;
    const nextGuideProfile = sharedGuideProfiles.get(nextGuideId);
    const nextGuideName = nextGuideProfile
      ? `${nextGuideProfile.first_name} ${nextGuideProfile.last_name}`
      : "Unknown";

    const { error } = await supabase
      .from("tours")
      .update({ guide_id: nextGuideId, status: nextStatus })
      .eq("id", tour.id);
    if (error) throw new Error(`Guide update error: ${error.message}`);

    if (previousGuideId !== session.user.id) {
      await sendPush(supabase, {
        to_user_id: previousGuideId,
        title: "Tour reassigned",
        body: `A tour on ${tour.date} is no longer assigned to you.`,
        data: { url: pageUrl },
      });
    }
    if (nextGuideId !== session.user.id) {
      await sendPush(supabase, {
        to_user_id: nextGuideId,
        title: nextStatus === "pending" ? "Tour reassignment pending" : "Tour reassigned",
        body: nextStatus === "pending"
          ? `${currentGuideName} reassigned a tour to you on ${tour.date}.`
          : `${currentGuideName} reassigned a tour to ${nextGuideName === currentGuideName ? "you" : nextGuideName} on ${tour.date}.`,
        data: { url: pageUrl },
      });
    }
  }

  async function openTourModal(tour) {
    if (!modal || !modalBody) return;
    openTourId = tour.id;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    try {
      await renderTourModal(tour);
    } catch (error) {
      console.error("renderTourModal error", error, { tourId: tour?.id, guideId: tour?.guide_id, type: tour?.type });
      while (modalBody.firstChild) modalBody.removeChild(modalBody.firstChild);
      const errorBox = document.createElement("div");
      errorBox.className = "muted";
      errorBox.textContent = `Tour modal error: ${error?.message || error}`;
      modalBody.appendChild(errorBox);
    }
  }

  async function renderTourModal(tour) {
    while (modalBody.firstChild) modalBody.removeChild(modalBody.firstChild);

    const session = getSession();
    const sharedGuideIds = getSharedGuideIds();
    const sharedGuideProfiles = getSharedGuideProfiles();
    const tourTypes = getTourTypes();

    const profile = sharedGuideProfiles.get(tour.guide_id);
    const guideName = profile
      ? `${profile.first_name} ${profile.last_name}`
      : "Unknown";
    const isPast = tour.date < getTodayISO();
    const isPrivate = isPrivateForViewer(tour);

    const headerRow = document.createElement("div");
    headerRow.className = `tour-row ${tour.status === "pending" ? "pending" : "accepted"}`;
    headerRow.textContent = `${formatShortDateNoYear(tour.date)} · ${(tour.start_time || "").slice(0, 5)} - ${(tour.end_time || "").slice(0, 5)} · ${guideName} · ${isPrivate ? "Private tour" : tour.type}`;
    modalBody.appendChild(headerRow);

    const isOwner = session && tour.guide_id === session.user.id;
    const isCreator = session && tour.created_by === session.user.id;
    const canManageLock = Boolean(session) && (isOwner || isCreator);
    const isLocked = Boolean(tour.participants_locked);
    const canEditParticipants = Boolean(session) && tour.status === "accepted" && !isLocked && !isPrivate;
    const canDeleteTour = Boolean(session) && !isPast && (isOwner || isCreator);
    const canEditTourGuide = Boolean(session) && !isPast && !isLocked && !isPrivate;
    const typeForTour = tourTypes.find((type) => type.guide_id === tour.guide_id && type.name === tour.type)
      || await loadTourTypeForTour(tour)
      || null;
    const platformForTour = tour.platform || getPlatformsForType(typeForTour)[0] || null;
    const participantPlatforms = getPlatformsForType(typeForTour);
    const isFreeTour = typeForTour?.payment_type === "free" || /free/i.test(String(tour.type || ""));
    const feePerParticipant = Number(platformForTour?.commission_percent || typeForTour?.fee_per_participant || 0);
    const currentPricePerPerson = Number.isFinite(Number(tour.price_per_person))
      ? Number(tour.price_per_person)
      : Number(isFreeTour ? feePerParticipant : (typeForTour?.ticket_price ?? 0));
    const defaultParticipantPaidAmount = isFreeTour ? null : currentPricePerPerson;
    const unresolvedParticipants = (tour.participants || []).filter(
      (participant) => participant.attendance_status !== "arrived" && participant.attendance_status !== "absent"
    );
    const arrivedParticipants = (tour.participants || []).filter(
      (participant) => participant.attendance_status === "arrived"
    );
    const arrivedPersonsCount = arrivedParticipants.reduce(
      (sum, participant) => sum + Number(participant.group_size || 0),
      0
    );
    const canLockParticipants = Boolean(session)
      && tour.status === "accepted"
      && !isPast
      && !isLocked
      && !isPrivate
      && unresolvedParticipants.length === 0
      && arrivedParticipants.length > 0
      && (isOwner || isCreator);

    if (canEditTourGuide) {
      const guideRow = document.createElement("div");
      guideRow.className = "form-row";

      const guideLabel = document.createElement("div");
      guideLabel.className = "muted participant-platform-label";
      guideLabel.textContent = "Guide";
      guideRow.appendChild(guideLabel);

      const guideSelect = document.createElement("select");
      guideSelect.className = "select";
      Array.from(sharedGuideIds).forEach((guideId) => {
        const option = document.createElement("option");
        const guideProfile = sharedGuideProfiles.get(guideId);
        option.value = guideId;
        option.textContent = guideProfile
          ? `${guideProfile.first_name} ${guideProfile.last_name}`
          : guideId;
        if (guideId === tour.guide_id) option.selected = true;
        guideSelect.appendChild(option);
      });
      guideRow.appendChild(guideSelect);

      const saveGuideBtn = document.createElement("button");
      saveGuideBtn.type = "button";
      saveGuideBtn.className = "ghost";
      saveGuideBtn.textContent = "Save guide";
      saveGuideBtn.addEventListener("click", async () => {
        const nextGuideId = guideSelect.value;
        if (!nextGuideId || nextGuideId === tour.guide_id) return;
        try {
          await saveTourGuideChange(tour, nextGuideId, guideName);
          await reloadData();
          await syncOpenTour();
        } catch (error) {
          alert(error.message);
        }
      });
      guideRow.appendChild(saveGuideBtn);
      modalBody.appendChild(guideRow);
    }

    const canEditTourPrice = Boolean(session) && !isLocked && (isOwner || isCreator);
    const priceRow = document.createElement("div");
    priceRow.className = "form-row";

    const priceLabel = document.createElement("div");
    priceLabel.className = "muted participant-platform-label";
    priceLabel.textContent = isFreeTour ? "Platform fee per participant" : "Default price per person";
    priceRow.appendChild(priceLabel);

    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.min = "0";
    priceInput.step = "0.01";
    priceInput.className = "input";
    priceInput.value = Number.isFinite(currentPricePerPerson) ? String(currentPricePerPerson) : "";
    priceInput.disabled = !canEditTourPrice;
    priceRow.appendChild(priceInput);

    if (canEditTourPrice) {
      const savePriceBtn = document.createElement("button");
      savePriceBtn.type = "button";
      savePriceBtn.className = "ghost";
      savePriceBtn.textContent = "Save default price";
      savePriceBtn.addEventListener("click", async () => {
        const nextPrice = Number(priceInput.value || "");
        if (!Number.isFinite(nextPrice) || nextPrice < 0) {
          alert("Enter a valid price per person.");
          return;
        }
        const { error } = await supabase
          .from("tours")
          .update({ price_per_person: nextPrice })
          .eq("id", tour.id);
        if (error) {
          alert(`Price update error: ${error.message}`);
          return;
        }
        await reloadData();
        await syncOpenTour();
      });
      priceRow.appendChild(savePriceBtn);
    }
    modalBody.appendChild(priceRow);

    const handleDeleteTour = async () => {
      if (!confirm("Delete this tour?")) return;
      if (tour.invoice_path) {
        const { error: storageError } = await supabase.storage
          .from("invoices")
          .remove([tour.invoice_path]);
        if (storageError) {
          alert(`Invoice delete error: ${storageError.message}`);
          return;
        }
      }
      const { data: deletedRows, error } = await supabase
        .from("tours")
        .delete()
        .eq("id", tour.id)
        .select("id,guide_id,created_by,date");
      if (error) {
        alert(`Delete error: ${error.message}`);
        return;
      }
      if (!deletedRows || deletedRows.length === 0) {
        alert("Delete failed: not allowed.");
        return;
      }

      const deleted = deletedRows[0];
      const notifyTarget =
        deleted.created_by === session.user.id && deleted.guide_id !== session.user.id
          ? deleted.guide_id
          : deleted.guide_id === session.user.id && deleted.created_by && deleted.created_by !== session.user.id
            ? deleted.created_by
            : null;
      if (notifyTarget) {
        await sendPush(supabase, {
          to_user_id: notifyTarget,
          title: "Tour removed",
          body: `A planned tour on ${deleted.date} was deleted.`,
          data: { url: pageUrl },
        });
      }
      closeTourModal();
      await reloadData();
    };

    if (tour.status === "pending" && isOwner) {
      const actions = document.createElement("div");
      actions.className = "form-row";

      const acceptBtn = document.createElement("button");
      acceptBtn.type = "button";
      acceptBtn.className = "primary";
      acceptBtn.textContent = "Accept";
      acceptBtn.addEventListener("click", async () => {
        const { error } = await supabase
          .from("tours")
          .update({ status: "accepted" })
          .eq("id", tour.id);
        if (!error) {
          if (tour.created_by && tour.created_by !== session.user.id) {
            await sendPush(supabase, {
              to_user_id: tour.created_by,
              title: "Tour accepted",
              body: `${guideName} accepted the tour on ${tour.date}.`,
              data: { url: pageUrl },
            });
          }
          await reloadData();
          await syncOpenTour();
        }
      });

      const declineBtn = document.createElement("button");
      declineBtn.type = "button";
      declineBtn.className = "ghost";
      declineBtn.textContent = "Decline";
      declineBtn.addEventListener("click", async () => {
        if (!confirm("Decline this tour? It will be removed.")) return;
        const { error } = await supabase.from("tours").delete().eq("id", tour.id);
        if (!error) {
          if (tour.created_by && tour.created_by !== session.user.id) {
            await sendPush(supabase, {
              to_user_id: tour.created_by,
              title: "Tour declined",
              body: `${guideName} declined the tour on ${tour.date}.`,
              data: { url: pageUrl },
            });
          }
          closeTourModal();
          await reloadData();
        }
      });

      actions.appendChild(acceptBtn);
      actions.appendChild(declineBtn);
      modalBody.appendChild(actions);
    }

    if (isPrivate) {
      const privateNote = document.createElement("div");
      privateNote.className = "muted";
      privateNote.textContent = "This tour is private.";
      modalBody.appendChild(privateNote);
      return;
    }

    const participantsTitle = document.createElement("div");
    participantsTitle.className = "details-title";
    participantsTitle.textContent = "Participants";
    modalBody.appendChild(participantsTitle);

    const list = document.createElement("div");
    list.className = "details-content";

    if (!tour.participants || tour.participants.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No participants yet.";
      list.appendChild(empty);
    } else {
      tour.participants.forEach((participant) => {
        const row = document.createElement("div");
        row.className = `participant${participant.attendance_status ? ` ${participant.attendance_status}` : ""}`;

        const participantInfo = document.createElement("div");
        participantInfo.className = "participant-info";

        const name = document.createElement("div");
        name.textContent = `${participant.name} (${participant.group_size})`;
        participantInfo.appendChild(name);

        const meta = document.createElement("div");
        meta.className = "muted";
        meta.textContent = formatParticipantMeta(participant, defaultParticipantPaidAmount) || "No booking metadata yet.";
        participantInfo.appendChild(meta);

        row.appendChild(participantInfo);

        if (canEditParticipants) {
          const actions = document.createElement("div");
          actions.className = "participant-actions";

          const paidAmountInput = document.createElement("input");
          paidAmountInput.type = "number";
          paidAmountInput.min = "0";
          paidAmountInput.step = "0.01";
          paidAmountInput.className = "input participant-price-input";
          const effectiveAmount = getParticipantAmount(participant, defaultParticipantPaidAmount);
          paidAmountInput.value = effectiveAmount == null ? "" : String(effectiveAmount);

          const saveBtn = document.createElement("button");
          saveBtn.type = "button";
          saveBtn.className = "ghost";
          saveBtn.textContent = "Save";
          saveBtn.addEventListener("click", async () => {
            const payload = {
              paid_amount: normalizeAmountValue(paidAmountInput.value),
            };
            const { error } = await supabase
              .from("participants")
              .update(payload)
              .eq("id", participant.id);
            if (!error) {
              await reloadData();
              await syncOpenTour();
            }
          });

          const arrivedBtn = document.createElement("button");
          arrivedBtn.type = "button";
          arrivedBtn.className = "ghost";
          arrivedBtn.textContent = "✓";
          arrivedBtn.title = "Arrived";
          arrivedBtn.addEventListener("click", async () => {
            const { error } = await supabase
              .from("participants")
              .update({ attendance_status: "arrived" })
              .eq("id", participant.id);
            if (!error) {
              await reloadData();
              await syncOpenTour();
            }
          });

          const absentBtn = document.createElement("button");
          absentBtn.type = "button";
          absentBtn.className = "ghost danger";
          absentBtn.textContent = "✕";
          absentBtn.title = "No show";
          absentBtn.addEventListener("click", async () => {
            const { error } = await supabase
              .from("participants")
              .update({ attendance_status: "absent" })
              .eq("id", participant.id);
            if (!error) {
              await reloadData();
              await syncOpenTour();
            }
          });

          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "ghost danger";
          removeBtn.textContent = "−";
          removeBtn.title = "Delete participant";
          removeBtn.addEventListener("click", async () => {
            if (!confirm("Delete this participant?")) return;
            const { error } = await supabase
              .from("participants")
              .delete()
              .eq("id", participant.id);
            if (!error) {
              await reloadData();
              await syncOpenTour();
            }
          });

          actions.appendChild(paidAmountInput);
          actions.appendChild(saveBtn);
          actions.appendChild(arrivedBtn);
          actions.appendChild(absentBtn);
          actions.appendChild(removeBtn);
          row.appendChild(actions);
        }

        list.appendChild(row);
      });
    }

    if (canEditParticipants) {
      const platformRow = document.createElement("div");
      platformRow.className = "form-row";

      const platformLabel = document.createElement("div");
      platformLabel.className = "muted participant-platform-label";
      platformLabel.textContent = "Platform";
      platformRow.appendChild(platformLabel);

      const participantPlatformSelect = document.createElement("select");
      participantPlatformSelect.className = "select";
      if (!participantPlatforms.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No platform configured";
        option.selected = true;
        participantPlatformSelect.appendChild(option);
        participantPlatformSelect.disabled = true;
      } else {
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Select platform";
        placeholder.selected = !platformForTour;
        participantPlatformSelect.appendChild(placeholder);
        participantPlatforms.forEach((platform) => {
          const option = document.createElement("option");
          option.value = platform.name || "";
          option.textContent = platform.name || "";
          if (platformForTour && platform.name === platformForTour.name) option.selected = true;
          participantPlatformSelect.appendChild(option);
        });
      }
      platformRow.appendChild(participantPlatformSelect);
      list.appendChild(platformRow);

      const bookingMetaRow = document.createElement("div");
      bookingMetaRow.className = "form-row participant-meta-row";

      const paidAmountInput = document.createElement("input");
      paidAmountInput.type = "number";
      paidAmountInput.min = "0";
      paidAmountInput.step = "0.01";
      paidAmountInput.className = "input participant-price-input";
      const defaultParticipantAmount = normalizeAmountValue(defaultParticipantPaidAmount);
      paidAmountInput.value = defaultParticipantAmount == null ? "" : String(defaultParticipantAmount);
      paidAmountInput.placeholder = "Paid per person";

      bookingMetaRow.appendChild(paidAmountInput);
      list.appendChild(bookingMetaRow);

      const importRow = document.createElement("div");
      importRow.className = "form-row";

      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.style.display = "none";

      const importBtn = document.createElement("button");
      importBtn.type = "button";
      importBtn.className = "ghost";
      importBtn.textContent = ocrBusy ? "Importing..." : "Import participants from screenshot";
      importBtn.disabled = ocrBusy;
      importBtn.addEventListener("click", () => fileInput.click());

      const importStatus = document.createElement("div");
      importStatus.className = "muted";

      fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        ocrBusy = true;
        importBtn.textContent = "Importing...";
        importBtn.disabled = true;
        importStatus.textContent = "Reading image...";

        try {
          const participants = await extractParticipantsFromImage(file);
          if (!participants.length) {
            importStatus.textContent = "No participants found.";
          } else {
            importStatus.textContent = `Found ${participants.length} participants.`;
            const platformName = participantPlatformSelect.value || null;
            if (!platformName) {
              importStatus.textContent = "Select a platform first.";
              return;
            }
            if (confirm(`Import ${participants.length} participants?`)) {
              const paidAmount = normalizeAmountValue(paidAmountInput.value);
              const { error } = await supabase.from("participants").insert(
                participants.map((participant) => ({
                  tour_id: tour.id,
                  name: participant.name,
                  group_size: participant.group_size,
                  platform_name: platformName,
                  paid_amount: paidAmount,
                }))
              );
              if (!error) {
                await reloadData();
                await syncOpenTour();
              }
            }
          }
        } catch {
          importStatus.textContent = "Import failed.";
        } finally {
          ocrBusy = false;
          importBtn.textContent = "Import participants from screenshot";
          importBtn.disabled = false;
          fileInput.value = "";
        }
      });

      importRow.appendChild(importBtn);
      importRow.appendChild(importStatus);
      list.appendChild(importRow);
      list.appendChild(fileInput);

      const form = document.createElement("div");
      form.className = "form-row participant-add-row";

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
        const selectedPlatformName = participantPlatformSelect.value || null;
        if (!name) return;
        if (!selectedPlatformName) {
          alert("Select a platform first.");
          return;
        }
        const { error } = await supabase.from("participants").insert({
          tour_id: tour.id,
          name,
          group_size: groupSize,
          platform_name: selectedPlatformName,
          paid_amount: normalizeAmountValue(paidAmountInput.value),
        });
        if (!error) {
          nameInput.value = "";
          groupInput.value = "1";
          await reloadData();
          await syncOpenTour();
        }
      });

      form.appendChild(nameInput);
      form.appendChild(groupInput);
      form.appendChild(addBtn);
      list.appendChild(form);
    }

    modalBody.appendChild(list);

    const footerActions = document.createElement("div");
    footerActions.className = "form-row modal-footer-actions";

    if (canManageLock && !isLocked) {
      const lockBtn = document.createElement("button");
      lockBtn.type = "button";
      lockBtn.className = "ghost danger";
      lockBtn.textContent = "Lock participants";
      lockBtn.disabled = !canLockParticipants;
      lockBtn.addEventListener("click", async () => {
        if (!canLockParticipants) return;
        if (!confirm("Lock participants permanently? This cannot be undone.")) return;
        const updatePayload = { participants_locked: true };
        try {
          const liveType = typeForTour || await loadTourTypeForTour(tour);
          const nameSuggestsFree = /free/i.test(String(tour.type || ""));
          const liveIsFreeTour = liveType?.payment_type === "free" || nameSuggestsFree;
          const livePlatform = tour.platform || getPlatformsForType(liveType)[0] || null;
          const liveFeePerParticipant = Number(livePlatform?.commission_percent || liveType?.fee_per_participant || feePerParticipant || 0);

          if (liveIsFreeTour) {
          const typeFromDb = await loadTourTypeForTour(tour);
            const dbPlatform = tour.platform || getPlatformsForType(typeFromDb)[0] || null;
            const effectiveFee = Number(tour.price_per_person ?? dbPlatform?.commission_percent ?? typeFromDb?.fee_per_participant ?? liveFeePerParticipant ?? 0);
            if (!Number.isFinite(effectiveFee) || effectiveFee <= 0) {
              alert("Fee per participant is missing for this free tour.");
              return;
            }
            updatePayload.free_amount_received = null;
            updatePayload.platform_due_amount = Number((arrivedPersonsCount * effectiveFee).toFixed(2));
          } else {
            const effectivePlatform = tour.platform || getPlatformsForType(liveType)[0] || null;
            if (!effectivePlatform) {
              alert("No platform is configured for this pre-paid tour.");
              return;
            }
            updatePayload.free_amount_received = null;
            updatePayload.platform_due_amount = null;
          }
        } catch (lockError) {
          alert(`Lock error: ${lockError?.message || lockError}`);
          return;
        }
        const { error } = await supabase
          .from("tours")
          .update(updatePayload)
          .eq("id", tour.id);
        if (!error) {
          await reloadData();
          await syncOpenTour();
        }
      });
      footerActions.appendChild(lockBtn);
      if (!canLockParticipants) {
        const reason = document.createElement("div");
        reason.className = "muted";
        if (tour.status !== "accepted") {
          reason.textContent = "Lock is available only after tour acceptance.";
        } else if (isPast) {
          reason.textContent = "Past tours cannot be locked.";
        } else if (isPrivate) {
          reason.textContent = "Private tours cannot be locked.";
        } else if (unresolvedParticipants.length > 0) {
          reason.textContent = "Set each participant as arrived or no-show before locking.";
        } else if (arrivedParticipants.length === 0) {
          reason.textContent = "At least one participant must be marked as arrived.";
        }
        footerActions.appendChild(reason);
      }
    } else if (isLocked) {
      const lockedNote = document.createElement("div");
      lockedNote.className = "muted";
      lockedNote.textContent = "Participants are locked.";
      modalBody.appendChild(lockedNote);
      if (isFreeTour) {
        const freeRow = document.createElement("div");
        freeRow.className = "form-row";

        const amountInput = document.createElement("input");
        amountInput.type = "number";
        amountInput.min = "0";
        amountInput.step = "0.01";
        amountInput.className = "input";
        amountInput.placeholder = "Amount received from participants";
        const computedCollectedAmount = Number(computeCollectedAmount(tour.participants || [], defaultParticipantPaidAmount).toFixed(2));
        amountInput.value = tour.free_amount_received == null
          ? (computedCollectedAmount > 0 ? String(computedCollectedAmount) : "")
          : String(tour.free_amount_received);

        const saveAmountBtn = document.createElement("button");
        saveAmountBtn.type = "button";
        saveAmountBtn.className = "ghost";
        saveAmountBtn.textContent = "Save amount";
        saveAmountBtn.addEventListener("click", async () => {
          const amount = Number(amountInput.value || "");
          if (!Number.isFinite(amount) || amount < 0) {
            alert("Enter a valid amount received.");
            return;
          }
          const { error } = await supabase
            .from("tours")
            .update({ free_amount_received: amount })
            .eq("id", tour.id);
          if (error) {
            alert(`Save amount error: ${error.message}`);
            return;
          }
          await reloadData();
          await syncOpenTour();
        });

        freeRow.appendChild(amountInput);
        freeRow.appendChild(saveAmountBtn);
        modalBody.appendChild(freeRow);

        const unitFee = Number(tour.price_per_person ?? feePerParticipant ?? 0);
        const computedPlatformDue = Number((arrivedPersonsCount * unitFee).toFixed(2));
        const platformDue = computedPlatformDue > 0
          ? computedPlatformDue
          : Number(tour.platform_due_amount || 0);
        const displayUnitFee = arrivedPersonsCount > 0
          ? Number((platformDue / arrivedPersonsCount).toFixed(2))
          : Number(unitFee || 0);
        const dueText = document.createElement("div");
        dueText.className = "platform-due-note";
        dueText.textContent = `Platform due: ${money(platformDue)} (${arrivedPersonsCount} participant${arrivedPersonsCount === 1 ? "" : "s"} x ${money(displayUnitFee)})`;
        modalBody.appendChild(dueText);
      }
    } else if (tour.status !== "accepted") {
      const pendingNote = document.createElement("div");
      pendingNote.className = "muted";
      pendingNote.textContent = "Lock is available only after tour acceptance.";
      modalBody.appendChild(pendingNote);
    }

    if (canDeleteTour) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "ghost";
      deleteBtn.textContent = "Delete tour";
      deleteBtn.addEventListener("click", handleDeleteTour);
      footerActions.appendChild(deleteBtn);
    }

    if (footerActions.childElementCount > 0) {
      modalBody.appendChild(footerActions);
    }
  }

  return {
    openTourModal,
    closeTourModal,
    syncOpenTour,
    getOpenTourId: () => openTourId,
  };
}
