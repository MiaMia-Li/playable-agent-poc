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
if (!/muted\s*:\s*true/i.test(html)) throw new Error("initial mute state is missing");
if (!/(?:mraid\.open|window\.open)/i.test(html)) throw new Error("store navigation is missing");

console.log("PASS");
