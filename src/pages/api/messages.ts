import type { APIRoute } from "astro";
import type { KVNamespace } from "@cloudflare/workers-types";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const kv = (locals as any)?.runtime?.env?.GUESTBOOK_KV as KVNamespace | undefined;
  if (!kv) {
    return new Response(JSON.stringify({ count: 0, entries: [] }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const list = await kv.list({ prefix: "msg:", limit: 1000 });
  // Newest first. Keys are zero-padded by ordinal, so a string sort is enough.
  const names = list.keys
    .map((k) => k.name)
    .sort()
    .reverse()
    .slice(0, 200);

  const entries = (await Promise.all(names.map((n) => kv.get(n, "json")))).filter(Boolean);

  return new Response(JSON.stringify({ count: entries.length, entries }, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
