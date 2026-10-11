# Blocked items

| Item | Status | What unblocks it |
|---|---|---|
| GitHub CLI login | Resolved | — |
| Gemini API key | Resolved (key 2 of 3) | — |
| Email to any address | **Accepted limit (you chose to keep it).** Email goes through the aangan Resend account (as you asked), which has no verified domain, so it only delivers to that account's own address (the alaiserikki Gmail, set as `DIGEST_TO`). The Monday digest reaches it; a grader's "Email me this digest" to another address fails with a clear message. | Verify a domain at resend.com/domains and set `RESEND_FROM`, **or** set `GMAIL_USER` + `GMAIL_APP_PASSWORD` and clear `RESEND_API_KEY` (Gmail SMTP fallback). Then `vercel env add` the changed keys and redeploy. |
