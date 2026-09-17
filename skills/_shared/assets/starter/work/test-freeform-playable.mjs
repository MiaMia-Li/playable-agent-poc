import { readFile } from "node:fs/promises";

const htmlPath = process.argv[2];
if (!htmlPath) throw new Error("usage: test-freeform-playable <html>");

const html = await readFile(htmlPath, "utf8");

if (!/<meta\s+name=["']viewport["'][^>]*width=device-width/i.test(html)) {
  throw new Error("responsive viewport is missing");
}
if (!/<canvas\b/i.test(html)) throw new Error("game canvas is missing");
if (!/<script\b[^>]*>([\s\S]*?)<\/script>/i.test(html)) throw new Error("embedded game script is missing");
if (!/window\.__PLAYABLE__/i.test(html)) throw new Error("playable contract is missing");
if (!/playable:set-muted/i.test(html)) throw new Error("mute message protocol is missing");
if (!/(?:pointerdown|click|touchstart)/i.test(html)) throw new Error("gameplay interaction is missing");
if (!/(?:mraid\.open|window\.open)/i.test(html)) throw new Error("store navigation is missing");

// Mirrors the platform's publish check: every resource must be embedded as data:/blob:.
const isEmbedded = (value) => /^(?:data:|blob:|#)/i.test(value.trim());
const resourceAttributes =
  /<(img|audio|video|source|script|link|iframe|object)\b[^>]*\b(?:src|href|poster|data|srcset)\s*=\s*["']([^"']+)["']/gi;
for (const match of html.matchAll(resourceAttributes)) {
  if (!isEmbedded(match[2])) {
    throw new Error(
      `external resource in <${match[1].toLowerCase()}> (${match[2].slice(0, 80)}): embed it as a data: URI; ` +
        "markup strings inside scripts are checked too",
    );
  }
}
const htmlWithoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
for (const match of htmlWithoutScripts.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
  if (!isEmbedded(match[1])) {
    throw new Error(`external CSS url(${match[1].slice(0, 80)}): embed it as a data: URI`);
  }
}
if (/(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/.test(html)) {
  throw new Error("text shaped like an API key (sk-...) is blocked at publish: rename that identifier or string");
}

console.log("PASS");
