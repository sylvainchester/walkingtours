const fs = require("fs");
const path = require("path");

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const vapid = process.env.VAPID_PUBLIC_KEY || "";
const functionsUrl = process.env.SUPABASE_FUNCTIONS_URL || (url ? url.replace(".supabase.co", ".functions.supabase.co") : "");

if (!url || !anon) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  process.exit(1);
}

const content = `export const SUPABASE_URL = ${JSON.stringify(url)};\nexport const SUPABASE_ANON_KEY = ${JSON.stringify(anon)};\nexport const VAPID_PUBLIC_KEY = ${JSON.stringify(vapid)};\nexport const SUPABASE_FUNCTIONS_URL = ${JSON.stringify(functionsUrl)};\n`;

fs.writeFileSync(path.join(__dirname, "config.js"), content, "utf8");
console.log("Generated config.js");
