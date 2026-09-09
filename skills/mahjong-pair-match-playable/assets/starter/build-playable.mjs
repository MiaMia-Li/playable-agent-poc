import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(root, "../..");
const mode = process.argv[2] || "center_collision";
const output = process.argv[3] || path.join(root, "outputs", `MahjongMatch_${mode}.html`);
const storeUrl = process.argv[4] || "https://play.google.com/store/apps/details?id=com.big.ludocafe";
const validModes = new Set(["center_collision", "top_rack", "gravity_fill", "perspective_3d"]);
if (!validModes.has(mode)) throw new Error(`Unknown mode: ${mode}`);

const mediaRoot = path.join(skillRoot, "assets", "default-media");
const endRoot = path.join(skillRoot, "assets", "default-endcard");
const templateRoot = path.join(skillRoot, "assets", "templates", mode);
const mime = file => ({
  ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp3": "audio/mpeg"
}[path.extname(file).toLowerCase()] || "application/octet-stream");
const dataUrl = async file => `data:${mime(file)};base64,${(await readFile(file)).toString("base64")}`;
const readJson = async file => JSON.parse(await readFile(file, "utf8"));
const optionalJson = async file => {
  try { return await readJson(file); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
};
const htmlText = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const workspaceRoot = process.cwd();
const confirmed = await optionalJson(path.join(workspaceRoot, "confirmed-config.json"));
const assetManifest = await optionalJson(path.join(workspaceRoot, "asset-manifest.json"));
const manifestAsset = (slot, prefix) => assetManifest?.assets?.find(asset => asset.slot === slot && asset.mimeType?.startsWith(prefix));
const manifestDataUrl = async asset => {
  if (!asset) return null;
  const absolute = path.resolve(workspaceRoot, asset.workspacePath);
  if (!absolute.startsWith(`${workspaceRoot}${path.sep}`)) throw new Error("asset path leaves workspace");
  return `data:${asset.mimeType};base64,${(await readFile(absolute)).toString("base64")}`;
};

const tileNames = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "眼睛", "蛇", "月亮", "火", "灯", "房子"];
const tiles = {};
for (const name of tileNames) tiles[name] = await dataUrl(path.join(mediaRoot, "麻将图标", `${name}.png`));
const assets = {
  background: await dataUrl(path.join(mediaRoot, "背景.jpg")),
  hand: await dataUrl(path.join(mediaRoot, "卡通手指.png")),
  tiles,
  audio: {
    bgm: await dataUrl(path.join(mediaRoot, "BGM.mp3")),
    click: await dataUrl(path.join(mediaRoot, "音效-点击麻将声.MP3")),
    match: await dataUrl(path.join(mediaRoot, "音效-破碎.mp3")),
    error: await dataUrl(path.join(mediaRoot, "音效-错误.mp3"))
  },
  endcard: {
    background: await dataUrl(path.join(endRoot, "endcard-bg.webp")),
    icon: await dataUrl(path.join(endRoot, "app-icon-rounded.webp")),
    title: await dataUrl(path.join(endRoot, "domino-title.webp")),
    button: await dataUrl(path.join(endRoot, "cta-button.webp"))
  }
};
const tileAsset = await manifestDataUrl(manifestAsset("tileFaces", "image/"));
if (tileAsset) {
  assets.tiles = {};
  assets.tileOverride = tileAsset;
}
const backgroundAsset = await manifestDataUrl(manifestAsset("backgroundBoard", "image/"));
if (backgroundAsset) assets.background = backgroundAsset;
const audioAsset = await manifestDataUrl(manifestAsset("audio", "audio/"));
if (audioAsset) assets.audio.bgm = audioAsset;
const endCardAsset = await manifestDataUrl(manifestAsset("endCard", "image/"));
if (endCardAsset) assets.endcard.background = endCardAsset;

const config = await readJson(path.join(templateRoot, "config.json"));
config.storeUrl = confirmed?.storeUrl || storeUrl;
config.tileKeys = Object.keys(tiles);
config.copy = confirmed?.copy || null;

let html = await readFile(path.join(root, "src", "playable.template.html"), "utf8");
html = html
  .replace("__ASSETS__", JSON.stringify(assets))
  .replace("__CONFIG__", JSON.stringify(config))
  .replaceAll("__DOCUMENT_LANG__", htmlText(confirmed?.copy?.locale || "zh-CN"))
  .replaceAll("__PLAYABLE_TITLE__", htmlText(confirmed?.copy?.title || "Mahjong Match Playable"))
  .replaceAll("__CTA_TEXT__", htmlText(confirmed?.copy?.cta || "立即试玩"))
  .replaceAll("__DISCLAIMER_TEXT__", htmlText(confirmed?.copy?.disclaimer || ""));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, html);
const bytes = (await stat(output)).size;
console.log("Playable artifact built");
const maxBytes = confirmed?.delivery?.maxBytes;
if (typeof maxBytes === "number" && bytes > maxBytes) {
  console.warn("Playable artifact exceeds the selected delivery size");
}
