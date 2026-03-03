const readline = require("readline");
const { google } = require("googleapis");

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  "http://localhost"
);

const scopes = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: scopes,
});

console.log("");
console.log("Open this URL in your browser, sign in with the Gmail account to poll, then paste the code below:");
console.log("");
console.log(authUrl);
console.log("");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("Authorization code: ", async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log("");
    console.log("GMAIL_REFRESH_TOKEN=");
    console.log(tokens.refresh_token || "");
    console.log("");
    console.log("GMAIL_ACCESS_TOKEN=");
    console.log(tokens.access_token || "");
    console.log("");
    if (!tokens.refresh_token) {
      console.log("No refresh token returned. Re-run and make sure prompt=consent is used, and approve with the Gmail account you want to read.");
    }
  } catch (error) {
    console.error("Token exchange failed:", error.message || error);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
});
