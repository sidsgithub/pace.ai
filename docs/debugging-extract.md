# Debugging: Profile Extraction Not Working on Prod (2026-04-26)

## Symptom
`extractProfile` always returned `{}` on production. The "Save your plan" button never appeared because `profileDraft` stayed empty and `profileReady` was never satisfied.

Worked locally because all errors were silently swallowed — `.catch(() => {})` in Onboarding.jsx and no `res.ok` check in `claude.js`.

## Root Causes (in order of discovery)

### 1. Service worker crashing on POST requests
`public/sw.js` had:
```js
if (e.request.method !== 'GET') return;
```
A bare `return` without calling `e.respondWith()` throws `TypeError: Failed to convert value to 'Response'` in the FetchEvent handler. Fixed by explicitly proxying non-GET requests:
```js
if (e.request.method !== 'GET') {
  e.respondWith(fetch(e.request));
  return;
}
```

### 2. Anthropic API rejecting messages ending with an assistant turn
`extract.js` was passing the full `withAssistant` array (which ends with an assistant message) directly to the Anthropic API. Claude rejects this with:
> `"This model does not support assistant message prefill. The conversation must end with a user message."`

### 3. Claude continuing the conversation instead of extracting (actual root cause)
Even after fixing the message format, Claude was still responding as the coaching assistant rather than extracting profile fields — because the messages were passed as a chat thread, so Claude saw itself as the participant and kept coaching.

**Fix:** Serialize the conversation as a plain text transcript and wrap it in a single user message. Claude then clearly acts as an extractor, not a participant:
```js
const transcript = messages
  .map(m => `${m.role === 'assistant' ? 'coach' : 'user'}: ${m.content}`)
  .join('\n\n')

messages: [{ role: 'user', content: transcript }]
```

## Files Changed
- `public/sw.js` — fix POST passthrough
- `api/extract.js` — pass transcript as single user message instead of chat thread
- `vercel.json` — attempted negative lookahead rewrite (reverted, not supported by Vercel)
