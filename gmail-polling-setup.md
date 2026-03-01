# Gmail Polling Setup

Environment variables for Vercel:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `POLL_BOOKINGS_TOKEN`

UptimeRobot target example:

`https://walkingtours.vercel.app/api/poll-bookings?token=YOUR_SECRET`

Recommended Gmail OAuth scopes:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.modify`

Behavior:

- polls unread Gmail messages
- stores each email in `public.incoming_booking_emails`
- imports participants when a single tour match is found
- marks the Gmail message as read after processing
