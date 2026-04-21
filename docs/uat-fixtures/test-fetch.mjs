// UAT Phase 5 fixture — exercises the envault fetch interceptor against
// the direct Kimi coding API (Anthropic-messages protocol).
//
// Usage:
//   envault run -- node test-fetch.mjs            # should print HTTP 200
//   envault run --no-intercept -- node test-fetch.mjs  # should print HTTP 401
//
// The script reads KIMI_API_KEY from env. If it looks like a pseudokey
// (envault-xxxxxxxx) it's placed directly in the Authorization header; the
// in-process fetch interceptor substitutes the real value before the request
// goes on the wire. Without --no-intercept, the literal pseudokey is sent
// and Kimi returns 401.

const URL = 'https://api.kimi.com/coding/v1/messages';
const key = process.env.KIMI_API_KEY;
if (!key) {
  console.error('KIMI_API_KEY not set. Run via: envault run -- node test-fetch.mjs');
  process.exit(2);
}

const body = {
  model: 'kimi-for-coding',
  max_tokens: 32,
  messages: [{ role: 'user', content: 'hi' }],
};

const res = await fetch(URL, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text.slice(0, 200));
process.exit(res.ok ? 0 : 1);
