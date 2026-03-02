const { google } = require("googleapis");
const { createClient } = require("@supabase/supabase-js");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-cron-token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.end(JSON.stringify(body));
}

function decodeBase64Url(value) {
  if (!value) return "";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function collectBodyParts(part, bucket = { text: [], html: [] }) {
  if (!part) return bucket;
  if (part.parts?.length) {
    part.parts.forEach((child) => collectBodyParts(child, bucket));
    return bucket;
  }
  const content = decodeBase64Url(part.body?.data || "");
  if (!content) return bucket;
  if (part.mimeType === "text/plain") bucket.text.push(content);
  if (part.mimeType === "text/html") bucket.html.push(content);
  return bucket;
}

function normalizeLines(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function dedupeNormalizedLines(text) {
  const seen = new Set();
  return normalizeLines(text).filter((line) => {
    const key = line.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function trimQuotedContent(text) {
  const lines = String(text || "").split("\n");
  const kept = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\s+/g, " ").trim();
    if (!line) {
      kept.push("");
      continue;
    }

    if (
      /^-{2,}\s*forwarded message\s*-{2,}$/i.test(line)
      || /^begin forwarded message:?$/i.test(line)
      || /^on .+ wrote:$/i.test(line)
    ) {
      break;
    }

    kept.push(line);
  }

  return kept.join("\n");
}

function buildMessageText(subject, parts) {
  const preferredBody = parts.text.length
    ? parts.text.join("\n\n")
    : parts.html.map(stripHtml).join("\n\n");
  const trimmed = trimQuotedContent(preferredBody);
  return dedupeNormalizedLines([subject, trimmed].filter(Boolean).join("\n\n")).join("\n");
}

function parseTimes(text) {
  const results = [];
  const regex = /\b(\d{1,2}):(\d{2})(?:\s*(am|pm))?\b/gi;
  for (const match of text.matchAll(regex)) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridian = (match[3] || "").toLowerCase();
    if (meridian === "pm" && hour < 12) hour += 12;
    if (meridian === "am" && hour === 12) hour = 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) continue;
    results.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
  return [...new Set(results)];
}

function parseDates(text) {
  const results = new Set();
  const currentYear = new Date().getFullYear();
  const monthMap = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };

  for (const match of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    results.add(`${match[1]}-${match[2]}-${match[3]}`);
  }
  for (const match of text.matchAll(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/g)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      results.add(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    }
  }
  for (const match of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s*(20\d{2})?\b/gi)) {
    const day = Number(match[1]);
    const month = monthMap[(match[2] || "").toLowerCase()];
    const year = Number(match[3] || currentYear);
    if (day >= 1 && day <= 31 && month) {
      results.add(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    }
  }
  for (const match of text.matchAll(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/gi)) {
    const month = monthMap[(match[1] || "").toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3] || currentYear);
    if (day >= 1 && day <= 31 && month) {
      results.add(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    }
  }
  return [...results];
}

function extractEmail(value) {
  const match = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

function parseHeaderDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extractParticipants(text) {
  const lines = normalizeLines(text);
  const ignore = /booking|reservation|confirm|voucher|tour|date|time|platform|payment|status|guide|ref|reference|total|guest details/i;
  const participants = [];
  let pendingName = null;

  const extractGroupSize = (line) => {
    const matches = Array.from(line.matchAll(/(\d+)\s*(adult|adults|child|children|kid|kids|infant|infants|niñ|nino|niño|nina|niña)/gi));
    if (!matches.length) return 0;
    return matches.reduce((sum, match) => sum + Number(match[1]), 0);
  };

  const cleanName = (line) => {
    let name = line;
    name = name.replace(/^\W*\d+\s+/, "");
    name = name.replace(/\s*(\d+\s*(adult|adults|child|children|kid|kids|infant|infants|niñ|nino|niño|nina|niña).*)$/i, "");
    name = name.replace(/^(name|guest|customer)\s*:\s*/i, "");
    return name.trim();
  };

  for (const line of lines) {
    const groupSize = extractGroupSize(line);
    if (groupSize > 0) {
      const name = cleanName(line);
      if (name && !ignore.test(name)) {
        participants.push({ name, group_size: groupSize });
        pendingName = null;
        continue;
      }
      if (pendingName) {
        participants.push({ name: pendingName, group_size: groupSize });
        pendingName = null;
      }
      continue;
    }

    const maybeName = cleanName(line);
    if (
      maybeName.length >= 3
      && /[A-Za-z]/.test(maybeName)
      && !ignore.test(maybeName)
      && !/\b(20\d{2}|\d{1,2}:\d{2})\b/.test(maybeName)
    ) {
      pendingName = maybeName;
    }
  }

  const unique = new Map();
  participants.forEach((participant) => {
    const key = `${participant.name.toLowerCase()}|${participant.group_size}`;
    if (!unique.has(key)) unique.set(key, participant);
  });
  return Array.from(unique.values());
}

function findMatchedPlatform(text, tourTypes) {
  const haystack = text.toLowerCase();
  const platformNames = new Set();
  (tourTypes || []).forEach((type) => {
    (Array.isArray(type.platforms) ? type.platforms : []).forEach((platform) => {
      const name = String(platform?.name || "").trim();
      if (name) platformNames.add(name);
    });
  });
  const ordered = Array.from(platformNames).sort((a, b) => b.length - a.length);
  return ordered.find((name) => haystack.includes(name.toLowerCase())) || null;
}

function findMatchedType(text, tourTypes) {
  const haystack = text.toLowerCase();
  const ordered = (tourTypes || [])
    .map((type) => type.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  return ordered.find((name) => haystack.includes(String(name).toLowerCase())) || null;
}

function matchTour({ text, tours, tourTypes }) {
  const dates = parseDates(text);
  const times = parseTimes(text);
  const matchedPlatform = findMatchedPlatform(text, tourTypes);
  const matchedType = findMatchedType(text, tourTypes);

  let candidates = [...(tours || [])];
  if (matchedType) {
    const byType = candidates.filter((tour) => tour.type === matchedType);
    if (byType.length) candidates = byType;
  }
  if (dates.length) {
    const byDate = candidates.filter((tour) => dates.includes(tour.date));
    if (byDate.length) candidates = byDate;
  }
  if (times.length) {
    const byTime = candidates.filter((tour) => times.includes(String(tour.start_time || "").slice(0, 5)));
    if (byTime.length) candidates = byTime;
  }
  if (matchedPlatform) {
    const byPlatform = candidates.filter((tour) => {
      const name = String(tour.platform?.name || "").trim();
      return name && name.toLowerCase() === matchedPlatform.toLowerCase();
    });
    if (byPlatform.length) candidates = byPlatform;
  }

  if (candidates.length !== 1) {
    return {
      matchedTour: null,
      matchedPlatform,
      matchedType,
      dates,
      times,
      ambiguityCount: candidates.length,
    };
  }

  return {
    matchedTour: candidates[0],
    matchedPlatform: matchedPlatform || String(candidates[0].platform?.name || "").trim() || null,
    matchedType,
    dates,
    times,
    ambiguityCount: 1,
  };
}

async function getGmailClient() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Gmail OAuth env vars");
  }
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

async function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    throw new Error("Missing Supabase server env vars");
  }
  return createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false },
  });
}

async function markMessageRead(gmail, messageId) {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });
  if (!["GET", "POST"].includes(req.method)) {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const expectedToken = process.env.POLL_BOOKINGS_TOKEN;
    const providedToken = req.query?.token || req.headers["x-cron-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const dryRun = String(req.query?.dry_run || req.body?.dry_run || "").toLowerCase() === "1"
      || String(req.query?.dry_run || req.body?.dry_run || "").toLowerCase() === "true";
    if (!expectedToken || providedToken !== expectedToken) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }

    const gmail = await getGmailClient();
    const supabase = await getSupabaseAdmin();
    const nowIso = new Date().toISOString().slice(0, 10);

    const [messagesRes, toursRes, tourTypesRes, existingEmailsRes] = await Promise.all([
      gmail.users.messages.list({
        userId: "me",
        q: "in:inbox is:unread newer_than:30d",
        maxResults: 20,
      }),
      supabase
        .from("tours")
        .select("id,date,start_time,end_time,type,platform,guide_id,status,participants_locked")
        .gte("date", nowIso)
        .order("date")
        .order("start_time"),
      supabase
        .from("tour_types")
        .select("guide_id,name,platforms")
        .order("name"),
      supabase
        .from("incoming_booking_emails")
        .select("gmail_message_id,status")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    if (toursRes.error) throw new Error(toursRes.error.message);
    if (tourTypesRes.error) throw new Error(tourTypesRes.error.message);
    if (existingEmailsRes.error) throw new Error(existingEmailsRes.error.message);

    const knownMessages = new Map(
      (existingEmailsRes.data || []).map((row) => [row.gmail_message_id, row.status])
    );

    const messages = messagesRes.data.messages || [];
    let imported = 0;
    let ignored = 0;
    let errors = 0;
    const details = [];

    for (const messageRef of messages) {
      const fullMessage = await gmail.users.messages.get({
        userId: "me",
        id: messageRef.id,
        format: "full",
      });

      const headers = new Map(
        (fullMessage.data.payload?.headers || []).map((header) => [header.name.toLowerCase(), header.value || ""])
      );
      const gmailMessageId = headers.get("message-id") || fullMessage.data.id;
      if (knownMessages.has(gmailMessageId) && knownMessages.get(gmailMessageId) === "imported") {
        if (!dryRun) await markMessageRead(gmail, fullMessage.data.id);
        continue;
      }

      const parts = collectBodyParts(fullMessage.data.payload);
      const subject = headers.get("subject") || "";
      const fromEmail = extractEmail(headers.get("from"));
      const receivedAt = parseHeaderDate(headers.get("date"));
      const rawText = buildMessageText(subject, parts);

      const participants = extractParticipants(rawText);
      const match = matchTour({
        text: rawText,
        tours: toursRes.data || [],
        tourTypes: tourTypesRes.data || [],
      });

      let status = "ignored";
      let errorMessage = null;
      let matchedTourId = null;
      let matchedPlatformName = match.matchedPlatform || null;
      let importedParticipants = [];

      try {
        if (!match.matchedTour) {
          status = "ignored";
          errorMessage = match.ambiguityCount > 1
            ? `Ambiguous tour match (${match.ambiguityCount} candidates)`
            : "No matching tour found";
        } else if (!matchedPlatformName) {
          status = "ignored";
          matchedTourId = match.matchedTour.id;
          errorMessage = "No platform matched from email";
        } else if (!participants.length) {
          status = "ignored";
          matchedTourId = match.matchedTour.id;
          errorMessage = "No participants detected";
        } else {
          matchedTourId = match.matchedTour.id;
          const rows = participants.map((participant) => ({
            tour_id: match.matchedTour.id,
            name: participant.name,
            group_size: participant.group_size,
            platform_name: matchedPlatformName,
          }));
          if (dryRun) {
            status = "imported";
            importedParticipants = rows.map((row) => ({
              name: row.name,
              group_size: row.group_size,
              platform_name: row.platform_name,
            }));
          } else {
            const { error: insertError } = await supabase.from("participants").insert(rows);
            if (insertError) {
              status = "error";
              errorMessage = insertError.message;
            } else {
              status = "imported";
              importedParticipants = rows.map((row) => ({
                name: row.name,
                group_size: row.group_size,
                platform_name: row.platform_name,
              }));
            }
          }
        }
      } catch (error) {
        status = "error";
        errorMessage = error.message;
      }

      const payload = {
        gmail_message_id: gmailMessageId,
        gmail_thread_id: fullMessage.data.threadId || null,
        subject,
        from_email: fromEmail,
        received_at: receivedAt,
        raw_text: rawText,
        matched_tour_id: matchedTourId,
        matched_platform_name: matchedPlatformName,
        imported_participants: importedParticipants,
        status,
        error_message: errorMessage,
        processed_at: new Date().toISOString(),
      };

      if (dryRun) {
        if (status === "imported") imported += 1;
        else if (status === "ignored") ignored += 1;
        else errors += 1;
        details.push({
          gmail_message_id: gmailMessageId,
          gmail_thread_id: fullMessage.data.threadId || null,
          subject,
          status,
          error: errorMessage,
          matched_tour_id: matchedTourId,
          matched_platform_name: matchedPlatformName,
          participants: importedParticipants.length ? importedParticipants : participants,
          parsed_dates: match.dates,
          parsed_times: match.times,
          raw_text_preview: rawText.slice(0, 1200),
        });
      } else {
        const { error: emailInsertError } = await supabase
          .from("incoming_booking_emails")
          .upsert(payload, { onConflict: "gmail_message_id" });
        if (emailInsertError) {
          status = "error";
          errors += 1;
          details.push({ subject, status, error: emailInsertError.message });
        } else {
          if (status === "imported") imported += 1;
          else if (status === "ignored") ignored += 1;
          else errors += 1;
          details.push({
            gmail_message_id: gmailMessageId,
            subject,
            status,
            error: errorMessage,
            matched_tour_id: matchedTourId,
            matched_platform_name: matchedPlatformName,
            participants: importedParticipants,
          });
        }
      }

      if (!dryRun) await markMessageRead(gmail, fullMessage.data.id);
    }

    return json(res, 200, {
      ok: true,
      dry_run: dryRun,
      checked: messages.length,
      imported,
      ignored,
      errors,
      details,
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: error?.message || String(error) });
  }
};
