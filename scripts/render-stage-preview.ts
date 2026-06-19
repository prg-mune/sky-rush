import { writeFileSync } from "fs";
import { stage, stageMetrics, stagePlatforms } from "../shared/stage-layout";

const stageId = "battle_01_garden";
const metrics = stageMetrics(stageId);
const platforms = stagePlatforms("battle", stageId);
const scale = 0.38;
const padding = 80;
const width = stage.width * scale + padding * 2;
const height = (metrics.spawnY + stage.playerH + 80 - stage.goalY) * scale + padding * 2;

function sx(x: number) {
  return padding + x * scale;
}

function sy(y: number) {
  return padding + (y - stage.goalY) * scale;
}

function platformColor(kind?: string) {
  if (kind === "vanish") return "#f2c960";
  if (kind === "stretch") return "#a78bfa";
  return "#6fc89a";
}

const rows = platforms.map((platform, index) => {
  const altitude = Math.round(metrics.spawnY - platform.y);
  return `
    <g>
      <rect x="${sx(platform.x).toFixed(1)}" y="${sy(platform.y).toFixed(1)}" width="${(platform.w * scale).toFixed(1)}" height="${Math.max(8, platform.h * scale).toFixed(1)}" rx="3" fill="${platformColor(platform.kind)}" stroke="#dce7ee" stroke-width="2" />
      <text x="${sx(platform.x + platform.w / 2).toFixed(1)}" y="${(sy(platform.y) - 6).toFixed(1)}" text-anchor="middle">${index} / ${altitude}m${platform.kind ? ` / ${platform.kind}` : ""}</text>
    </g>`;
}).join("");

const routeBands = [
  { y: 1930, label: "序盤: 5ルート" },
  { y: 1390, label: "中盤: 3ルート" },
  { y: 850, label: "終盤前: 2ルート" },
  { y: 600, label: "終盤: 1ルート" }
].map((band) => `
  <line x1="${padding}" y1="${sy(band.y).toFixed(1)}" x2="${(width - padding).toFixed(1)}" y2="${sy(band.y).toFixed(1)}" stroke="rgba(255,255,255,0.16)" stroke-dasharray="6 8" />
  <text x="${padding}" y="${(sy(band.y) - 10).toFixed(1)}" class="band">${band.label}</text>
`).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" role="img" aria-label="はじまりの空庭のコース配置">
    <style>
      text { fill: #eef7ff; font-size: 13px; font-weight: 700; font-family: system-ui, sans-serif; paint-order: stroke; stroke: #071724; stroke-width: 4px; }
      .band { fill: #9fd8ff; font-size: 15px; }
      .goal { fill: #ffd166; font-size: 18px; }
    </style>
    <rect width="100%" height="100%" fill="#0f2c40" />
    ${routeBands}
    <line x1="${sx(stage.spawnX - 950).toFixed(1)}" y1="${sy(metrics.spawnY + stage.playerH).toFixed(1)}" x2="${sx(stage.spawnX + 950).toFixed(1)}" y2="${sy(metrics.spawnY + stage.playerH).toFixed(1)}" stroke="#ffffff" stroke-width="2" opacity="0.2" />
    <text x="${sx(stage.spawnX).toFixed(1)}" y="${(sy(metrics.spawnY + stage.playerH) + 34).toFixed(1)}" text-anchor="middle">START FLOOR / 20人対応</text>
    <text x="${sx(stage.spawnX).toFixed(1)}" y="${(sy(stage.goalY) + 12).toFixed(1)}" text-anchor="middle" class="goal">GOAL</text>
    ${rows}
  </svg>`;

const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sky Rush Stage Preview</title>
  <style>
    body { margin: 0; background: #0c2638; color: #eef7ff; font-family: system-ui, sans-serif; }
    header { position: sticky; top: 0; z-index: 1; padding: 18px 24px; background: rgba(6, 19, 31, 0.92); border-bottom: 1px solid rgba(255,255,255,0.14); }
    h1 { margin: 0; font-size: 22px; }
    p { margin: 6px 0 0; color: #bcd1df; }
    svg { display: block; width: 100%; height: auto; }
    text { fill: #eef7ff; font-size: 13px; font-weight: 700; paint-order: stroke; stroke: #071724; stroke-width: 4px; }
    .band { fill: #9fd8ff; font-size: 15px; }
    .goal { fill: #ffd166; font-size: 18px; }
  </style>
</head>
<body>
  <header>
    <h1>はじまりの空庭 コースプレビュー</h1>
    <p>スタート床 → 序盤5ルート → 中盤3ルート → 終盤1ルート。黄色は消える床、紫は伸縮バーです。</p>
  </header>
  ${svg}
</body>
</html>
`;

writeFileSync("stage-preview.html", html, "utf8");
writeFileSync("stage-preview.svg", `<?xml version="1.0" encoding="UTF-8"?>${svg}`, "utf8");
console.log("Generated stage-preview.html and stage-preview.svg");
