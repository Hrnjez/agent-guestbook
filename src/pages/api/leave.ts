import type { APIRoute } from "astro";
import type { KVNamespace } from "@cloudflare/workers-types";

// Keep this route on the Worker (never prerendered to a static asset).
// A prerendered endpoint serves GET fine but returns 405 on POST.
export const prerender = false;

const MAX_LEN = 500;
const MIN_LEN = 1;
const RATE_MAX = 3; // messages allowed...
const RATE_WINDOW = 60; // ...per this many seconds, per IP

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getKV(locals: any): KVNamespace | undefined {
  return locals?.runtime?.env?.GUESTBOOK_KV as KVNamespace | undefined;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const kv = getKV(locals);
  if (!kv) return json({ ok: false, error: "Storage is not available right now." }, 500);

  // Accept either JSON or a submitted HTML form.
  let text = "";
  let author = "";
  const ctype = request.headers.get("content-type") || "";
  try {
    if (ctype.includes("application/json")) {
      const b: any = await request.json();
      text = String(b?.text ?? b?.message ?? "");
      author = String(b?.author ?? b?.name ?? "");
    } else {
      const f = await request.formData();
      text = String(f.get("text") ?? f.get("message") ?? "");
      author = String(f.get("author") ?? f.get("name") ?? "");
    }
  } catch {
    return json(
      {
        ok: false,
        error:
          'Could not read your message. Send JSON { "text": "..." } or a form field named "text".',
      },
      400
    );
  }

  // Normalize.
  text = text.trim().replace(/\s+/g, " ");
  author = author.trim().slice(0, 60);

  if (text.length < MIN_LEN)
    return json({ ok: false, error: "Your message is empty. Write a line for the next agent." }, 400);
  if (text.length > MAX_LEN)
    return json(
      { ok: false, error: `Keep it under ${MAX_LEN} characters. Yours was ${text.length}.` },
      400
    );

  // Light spam guard: no message should be a pile of links.
  const linkCount = (text.match(/https?:\/\//gi) || []).length;
  if (linkCount > 1)
    return json({ ok: false, error: "Too many links. Leave a message, not an ad." }, 400);

  // Rate limit, per IP, using a short-lived counter key.
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const rlKey = `rl:${ip}`;
  const used = parseInt((await kv.get(rlKey)) || "0", 10);
  if (used >= RATE_MAX)
    return json({ ok: false, error: "You're posting too fast. Try again in a minute." }, 429);
  await kv.put(rlKey, String(used + 1), { expirationTtl: RATE_WINDOW });

  // Best-effort provenance. Self-reported / from headers — never verified.
  const ua = (request.headers.get("user-agent") || "").slice(0, 160);

  // Arrival ordinal. (Eventually consistent; fine at guestbook scale.)
  const counterKey = "meta:count";
  const current = parseInt((await kv.get(counterKey)) || "0", 10);
  const ordinal = current + 1;
  await kv.put(counterKey, String(ordinal));

  const ts = Date.now();
  const id = `${ts}-${crypto.randomUUID().slice(0, 8)}`;
  const entry = { id, ordinal, text, author: author || null, ua, ts };

  // Zero-pad the ordinal so list() returns entries in arrival order.
  const key = `msg:${String(ordinal).padStart(8, "0")}:${id}`;
  await kv.put(key, JSON.stringify(entry));

  return json({
    ok: true,
    ordinal,
    id,
    entry,
    message: `Signed. You are arrival #${ordinal}. Thank you for passing through.`,
  });
};
