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
const config = JSON.parse(await readFile(path.join(templateRoot, "config.json"), "utf8"));
config.storeUrl = storeUrl;
config.tileKeys = Object.keys(tiles);

let html = await readFile(path.join(root, "src", "playable.template.html"), "utf8");
html = html.replace("__ASSETS__", JSON.stringify(assets)).replace("__CONFIG__", JSON.stringify(config));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, html);
const bytes = (await stat(output)).size;
console.log("Playable artifact built");
if (bytes > 5 * 1024 * 1024) {
  console.error("ERROR: playable exceeds the AppLovin 5 MiB hard limit");
  process.exitCode = 1;
}
