import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const layouts = ["photo-table", "triptych", "hero-plus-two", "grid-4", "filmstrip", "polaroid-stack", "split-screen", "single-framed"];
const colors = ["#f2ae72", "#8ca7a0", "#637992", "#e5c78a", "#72918b", "#bb9278"];
function cell(x, y, w, h, n) {
  return `<defs><linearGradient id="g${n}" x2="0" y2="1"><stop stop-color="${colors[n % colors.length]}"/><stop offset="1" stop-color="${colors[(n + 2) % colors.length]}"/></linearGradient></defs><g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="url(#g${n})"/><path d="M${x} ${y + h * .72}l${w * .28}-${h * .3} ${w * .17} ${h * .24} ${w * .21}-${h * .43} ${w * .34} ${h * .49}v${h * .28}H${x}Z" fill="#263c4e" opacity=".9"/></g>`;
}
function frame(layout, x, y) {
  const w = 150, h = 266, cells = [];
  const add = (left, top, width, height, n) => cells.push(cell(x + left, y + top, width, height, n));
  if (layout === "triptych") for (let i = 0; i < 3; i++) add(i * 50, 0, 49, h, i);
  else if (layout === "hero-plus-two") { add(0, 0, 98, h, 0); add(100, 0, 50, 132, 1); add(100, 134, 50, 132, 2); }
  else if (layout === "grid-4") { for (let i = 0; i < 4; i++) add((i % 2) * 75, Math.floor(i / 2) * 133, 74, 132, i); }
  else if (layout === "filmstrip") { for (let i = 0; i < 5; i++) add(i * 30, 54, 29, 158, i); }
  else if (layout === "split-screen") { add(0, 0, w, 132, 0); add(0, 134, w, 132, 1); }
  else if (layout === "single-framed") { cells.push(`<rect x="${x + 5}" y="${y + 5}" width="140" height="256" rx="3" fill="#fafaf7"/>`); add(15, 15, 120, 236, 0); }
  else if (layout === "polaroid-stack") { add(34, 59, 94, 145, 0); add(20, 82, 94, 145, 1); add(38, 105, 94, 145, 2); }
  else { add(18, 28, 62, 70, 0); add(78, 59, 62, 70, 1); add(13, 128, 62, 70, 2); add(78, 158, 62, 70, 3); add(37, 198, 62, 60, 4); }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${layout === "photo-table" ? "#795638" : "#14283a"}"/>${cells.join("")}`;
}
const blocks = layouts.map((name, i) => {
  const x = 34 + (i % 4) * 280, y = 73 + Math.floor(i / 4) * 365;
  return `<text x="${x}" y="${y - 15}" font-family="Arial" font-size="14" font-weight="700" fill="#14283a">${name}</text>${frame(name, x, y)}`;
}).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1188" height="810" viewBox="0 0 1188 810"><rect width="100%" height="100%" fill="#f4f5f3"/><text x="34" y="36" font-family="Arial" font-size="20" font-weight="700" fill="#14283a">Mosaé collage layouts · 9:16 stills</text>${blocks}</svg>`;
const out = new URL("../../../docs/design/collage-library/contact-sheet.png", import.meta.url);
await mkdir(new URL("./", out), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(out.pathname);
console.log(out.pathname);
