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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function verifyUserId(req) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const authHeader = req.headers.authorization || "";
  if (!supabaseUrl || !anonKey || !authHeader.startsWith("Bearer ")) return null;

  const accessToken = authHeader.slice("Bearer ".length).trim();
  if (!accessToken) return null;

  try {
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await authClient.auth.getUser(accessToken);
    if (!error && data?.user?.id) return data.user.id;
  } catch (_error) {
    // Fall back to direct Auth API call below.
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: authHeader,
    },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id || null;
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

function cleanForwardHeaders(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => {
      const normalized = line.replace(/\s+/g, " ").trim();
      if (!normalized) return true;
      return !/^\*?(from|date|to|subject):\*?/i.test(normalized);
    })
    .join("\n");
}

function buildMessageText(subject, parts) {
  const preferredBody = parts.text.length
    ? parts.text.join("\n\n")
    : parts.html.map(stripHtml).join("\n\n");
  const trimmed = cleanForwardHeaders(trimQuotedContent(preferredBody));
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

function extractPriorityDates(text, subject) {
  const candidates = [];
  const seen = new Set();
  const pushDates = (dates) => {
    dates.forEach((date) => {
      if (!seen.has(date)) {
        seen.add(date);
        candidates.push(date);
      }
    });
  };

  pushDates(parseDates(subject));

  const lines = normalizeLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^date and time$/i.test(line)) {
      pushDates(parseDates(`${line}\n${lines[index + 1] || ""}\n${lines[index + 2] || ""}`));
    }
    if (/booked your (experience|trip) for/i.test(line)) {
      pushDates(parseDates(line));
    }
  }

  pushDates(parseDates(text));
  return candidates;
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

function parseJsonSafely(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractTextFromResponsePayload(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const contentTexts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        contentTexts.push(content.text);
      }
      if (content.type === "text" && typeof content.text === "string") {
        contentTexts.push(content.text);
      }
    }
  }
  return contentTexts.join("\n").trim();
}

function normalizeTimeValue(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridian = (match[3] || "").toLowerCase();
  if (meridian === "pm" && hour < 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function matchTourFromLLM(extraction, tours) {
  if (!extraction || !Array.isArray(tours)) {
    return { matchedTour: null, ambiguityCount: 0 };
  }

  let candidates = [...tours];
  const matchedPlatform = String(extraction.platform_name || "").trim() || null;
  const matchedType = String(extraction.tour_name || "").trim() || null;
  const normalizedDate = String(extraction.date || "").trim() || null;
  const normalizedTime = normalizeTimeValue(extraction.start_time);

  if (matchedType) {
    const byType = candidates.filter(
      (tour) => String(tour.type || "").trim().toLowerCase() === matchedType.toLowerCase()
    );
    if (byType.length) candidates = byType;
  }
  if (normalizedDate) {
    const byDate = candidates.filter((tour) => tour.date === normalizedDate);
    if (byDate.length) candidates = byDate;
  }
  if (normalizedTime) {
    const byTime = candidates.filter((tour) => String(tour.start_time || "").slice(0, 5) === normalizedTime);
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
      dates: normalizedDate ? [normalizedDate] : [],
      times: normalizedTime ? [normalizedTime] : [],
      ambiguityCount: candidates.length,
    };
  }

  return {
    matchedTour: candidates[0],
    matchedPlatform: matchedPlatform || String(candidates[0].platform?.name || "").trim() || null,
    matchedType,
    dates: normalizedDate ? [normalizedDate] : [],
    times: normalizedTime ? [normalizedTime] : [],
    ambiguityCount: 1,
  };
}

async function extractWithLLM({ subject, rawText }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.2";
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      platform_name: { type: ["string", "null"] },
      tour_name: { type: ["string", "null"] },
      date: { type: ["string", "null"] },
      start_time: { type: ["string", "null"] },
      end_time: { type: ["string", "null"] },
      booking_name: { type: ["string", "null"] },
      participants: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: ["string", "null"] },
            group_size: { type: "integer" },
          },
          required: ["name", "group_size"],
        },
      },
      confidence_notes: { type: ["string", "null"] },
    },
    required: [
      "platform_name",
      "tour_name",
      "date",
      "start_time",
      "end_time",
      "booking_name",
      "participants",
      "confidence_notes",
    ],
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "Extract booking information from a forwarded reservation email. " +
                "Return JSON only. Prefer the booked experience date/time over email sent date, cancellation date, or policy dates. " +
                "If a value is missing, return null. If only one booking contact exists and the total guest count is clear, " +
                "you may use that person's name with the detected group size.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Subject: ${subject}\n\nEmail body:\n${rawText}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "booking_email_extraction",
          strict: true,
          schema,
        },
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI error ${response.status}`);
  }

  const jsonText = extractTextFromResponsePayload(payload);
  const parsed = parseJsonSafely(jsonText);
  if (!parsed) {
    throw new Error("OpenAI did not return valid JSON");
  }

  return {
    model,
    parsed,
    raw: payload,
  };
}

function extractParticipants(text) {
  const lines = normalizeLines(text);
  const ignore = /booking|reservation|confirm|voucher|tour|date|time|platform|payment|status|guide|ref|reference|total|guest details/i;
  const nonName = /^(adult|adults|child|children|kid|kids|infant|infants|guest|guests)$/i;
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
      if (name && !ignore.test(name) && !nonName.test(name)) {
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
      && !nonName.test(maybeName)
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

function matchTour({ text, subject, tours, tourTypes }) {
  const dates = extractPriorityDates(text, subject);
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

function buildSharedGuideIds(rows, callerId) {
  const ids = new Set([callerId]);
  (rows || []).forEach((row) => {
    if (row.guide_id === callerId || row.shared_with_id === callerId) {
      if (row.guide_id) ids.add(row.guide_id);
      if (row.shared_with_id) ids.add(row.shared_with_id);
    }
  });
  return Array.from(ids);
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
    const useLlm = String(req.query?.use_llm || req.body?.use_llm || "").toLowerCase() === "1"
      || String(req.query?.use_llm || req.body?.use_llm || "").toLowerCase() === "true";
    const tokenAuthorized = Boolean(expectedToken) && providedToken === expectedToken;
    const userId = tokenAuthorized ? null : await verifyUserId(req);
    if (!tokenAuthorized && !userId) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }

    const gmail = await getGmailClient();
    const supabase = await getSupabaseAdmin();
    const nowIso = new Date().toISOString().slice(0, 10);

    const [messagesRes, toursRes, tourTypesRes, existingEmailsRes, profilesRes, shareRowsRes] = await Promise.all([
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
      supabase
        .from("guide_profiles")
        .select("id,email"),
      supabase
        .from("guide_shares")
        .select("guide_id,shared_with_id"),
    ]);

    if (toursRes.error) throw new Error(toursRes.error.message);
    if (tourTypesRes.error) throw new Error(tourTypesRes.error.message);
    if (existingEmailsRes.error) throw new Error(existingEmailsRes.error.message);
    if (profilesRes.error) throw new Error(profilesRes.error.message);
    if (shareRowsRes.error) throw new Error(shareRowsRes.error.message);

    const knownMessages = new Map(
      (existingEmailsRes.data || []).map((row) => [row.gmail_message_id, row.status])
    );
    const guideByEmail = new Map(
      (profilesRes.data || [])
        .filter((profile) => normalizeEmail(profile.email))
        .map((profile) => [normalizeEmail(profile.email), profile])
    );
    const sharedGuideIdsByGuideId = new Map(
      (profilesRes.data || []).map((profile) => [
        profile.id,
        buildSharedGuideIds(shareRowsRes.data || [], profile.id),
      ])
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
      if (
        knownMessages.has(gmailMessageId)
        && ["pending_review", "confirmed", "rejected", "ignored"].includes(knownMessages.get(gmailMessageId))
      ) {
        if (!dryRun) await markMessageRead(gmail, fullMessage.data.id);
        continue;
      }

      const parts = collectBodyParts(fullMessage.data.payload);
      const subject = headers.get("subject") || "";
      const fromEmail = normalizeEmail(extractEmail(headers.get("from")));
      const receivedAt = parseHeaderDate(headers.get("date"));
      const rawText = buildMessageText(subject, parts);
      const senderGuide = guideByEmail.get(fromEmail);
      const allowedGuideIds = senderGuide
        ? (sharedGuideIdsByGuideId.get(senderGuide.id) || [senderGuide.id])
        : [];
      const candidateTours = (toursRes.data || []).filter((tour) => allowedGuideIds.includes(tour.guide_id));
      const candidateTourTypes = (tourTypesRes.data || []).filter((tourType) => allowedGuideIds.includes(tourType.guide_id));

      const participants = extractParticipants(rawText);
      let llmExtraction = null;
      if (useLlm) {
        try {
          llmExtraction = await extractWithLLM({ subject, rawText });
        } catch (error) {
          llmExtraction = { error: error.message };
        }
      }
      const parsedLlm = llmExtraction?.parsed || null;
      const extractedParticipants = parsedLlm?.participants
        ?.filter((participant) => participant && participant.group_size > 0)
        .map((participant) => ({
          name: String(participant.name || parsedLlm.booking_name || "").trim(),
          group_size: Number(participant.group_size),
        }))
        .filter((participant) => participant.name)
        || [];
      const effectiveParticipants = useLlm && extractedParticipants.length ? extractedParticipants : participants;
      const match = senderGuide
        ? (useLlm && parsedLlm
            ? matchTourFromLLM(parsedLlm, candidateTours)
            : matchTour({
                text: rawText,
                subject,
                tours: candidateTours,
                tourTypes: candidateTourTypes,
              }))
        : {
            matchedTour: null,
            matchedPlatform: null,
            matchedType: null,
            dates: [],
            times: [],
            ambiguityCount: 0,
          };

      let status = "ignored";
      let errorMessage = null;
      let matchedTourId = null;
      let matchedPlatformName = match.matchedPlatform || null;
      let proposedParticipants = [];

      try {
        if (!senderGuide) {
          status = "ignored";
          errorMessage = "Sender email is not a known guide";
        } else if (!match.matchedTour) {
          status = "ignored";
          errorMessage = match.ambiguityCount > 1
            ? `Ambiguous tour match (${match.ambiguityCount} candidates)`
            : "No matching tour found";
        } else if (!matchedPlatformName) {
          status = "ignored";
          matchedTourId = match.matchedTour.id;
          errorMessage = "No platform matched from email";
        } else if (!effectiveParticipants.length) {
          status = "ignored";
          matchedTourId = match.matchedTour.id;
          errorMessage = "No participants detected";
        } else {
          matchedTourId = match.matchedTour.id;
          const rows = effectiveParticipants.map((participant) => ({
            name: participant.name,
            group_size: participant.group_size,
            platform_name: matchedPlatformName,
          }));
          if (dryRun) {
            status = "imported";
            proposedParticipants = rows.map((row) => ({
              name: row.name,
              group_size: row.group_size,
              platform_name: row.platform_name,
            }));
          } else {
            status = "pending_review";
            proposedParticipants = rows.map((row) => ({
              name: row.name,
              group_size: row.group_size,
              platform_name: row.platform_name,
            }));
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
        from_email: fromEmail || null,
        received_at: receivedAt,
        raw_text: rawText,
        matched_tour_id: matchedTourId,
        matched_platform_name: matchedPlatformName,
        imported_participants: proposedParticipants,
        llm_extraction: llmExtraction?.parsed || {},
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
          participants: proposedParticipants.length ? proposedParticipants : effectiveParticipants,
          parsed_dates: match.dates,
          parsed_times: match.times,
          raw_text_preview: rawText.slice(0, 1200),
          llm_extraction: llmExtraction ? {
            model: llmExtraction.model,
            parsed: llmExtraction.parsed,
            error: llmExtraction.error || null,
          } : null,
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
          if (status === "pending_review") imported += 1;
          else if (status === "ignored") ignored += 1;
          else errors += 1;
          details.push({
            gmail_message_id: gmailMessageId,
            subject,
            status,
            error: errorMessage,
            matched_tour_id: matchedTourId,
            matched_platform_name: matchedPlatformName,
            participants: proposedParticipants,
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
