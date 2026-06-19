import { writeFileSync } from "fs";
import type { GameMode, StageId } from "../shared/types";
import { stage, stageMetrics, stagePlatforms } from "../shared/stage-layout";

const previews: Array<{
  id: StageId;
  mode: GameMode;
  title: string;
  note: string;
  bands: Array<{ altitude: number; label: string }>;
}> = [
  {
    id: "battle_01_garden",
    mode: "battle",
    title: "はじまりの空庭",
    note: "昔の自然な散らばり感をベースにした初級コース。黄色は消える床、紫は伸縮バーです。",
    bands: [
      { altitude: 225, label: "序盤: 横に散る" },
      { altitude: 720, label: "中盤: ルート選択" },
      { altitude: 1210, label: "終盤前: タイミング" },
      { altitude: 1740, label: "終盤: ゴールへ" }
    ]
  },
  {
    id: "battle_03_cloud_jumble",
    mode: "battle",
    title: "雲間ジャンブル",
    note: "5000mの中級コース。消える床を多めにしつつ、左右へ自然に散らばる配置です。",
    bands: [
      { altitude: 270, label: "序盤: 広めに散る" },
      { altitude: 1590, label: "中盤: 消える床多め" },
      { altitude: 2910, label: "後半: ルート収束" },
      { altitude: 4230, label: "終盤: タイミング勝負" }
    ]
  },
  {
    id: "battle_07_cup_qualifier",
    mode: "battle",
    title: "スカイラッシュ杯 予選",
    note: "5000mの20人対戦向けコース。序盤は広く、中盤で合流し、終盤は1ルート寄りに収束します。",
    bands: [
      { altitude: 270, label: "序盤: 3ルートでばらける" },
      { altitude: 1590, label: "中盤: 合流と押し合い" },
      { altitude: 2910, label: "後半: 消える床と伸縮バー" },
      { altitude: 4230, label: "終盤: 予選突破ルートへ収束" }
    ]
  },
  {
    id: "battle_10_everest_rush",
    mode: "battle",
    title: "エベレスト・ラッシュ",
    note: "8000mの超上級コース。短い消える床が中心で、最後まで集中力が必要です。",
    bands: [
      { altitude: 500, label: "序盤: 足場が細くなる" },
      { altitude: 2500, label: "中盤: 消える床が主役" },
      { altitude: 5200, label: "後半: リカバリー少なめ" },
      { altitude: 7350, label: "終盤: エベレスト級の詰め" }
    ]
  },
  {
    id: "team_01_skybase",
    mode: "team",
    title: "チーム・スカイベース",
    note: "味方踏み台、高壁エリア、チーム協力ジャンプを使う初級チーム登山コースです。",
    bands: [
      { altitude: 260, label: "序盤: 全員でスタート" },
      { altitude: 760, label: "協力: 味方踏み台" },
      { altitude: 1220, label: "高壁: チームで突破" },
      { altitude: 1690, label: "終盤: ゴールへ合流" }
    ]
  }
];

const scale = 0.32;
const padding = 80;
const width = stage.width * scale + padding * 2;

function sx(x: number) {
  return padding + x * scale;
}

function platformColor(kind?: string) {
  if (kind === "vanish") return "#f2c960";
  if (kind === "stretch") return "#a78bfa";
  return "#6fc89a";
}

function renderStage(preview: (typeof previews)[number], offsetY: number) {
  const metrics = stageMetrics(preview.id);
  const platforms = stagePlatforms(preview.mode, preview.id);
  const localHeight = (metrics.spawnY + stage.playerH + 80 - stage.goalY) * scale + padding * 2;

  const sy = (y: number) => offsetY + padding + (y - stage.goalY) * scale;
  const altitudeY = (altitude: number) => sy(metrics.spawnY - altitude);

  const rows = platforms.map((platform, index) => {
    const altitude = Math.round(metrics.spawnY - platform.y);
    return `
    <g>
      <rect x="${sx(platform.x).toFixed(1)}" y="${sy(platform.y).toFixed(1)}" width="${(platform.w * scale).toFixed(1)}" height="${Math.max(8, platform.h * scale).toFixed(1)}" rx="3" fill="${platformColor(platform.kind)}" stroke="#dce7ee" stroke-width="2" />
      <text x="${sx(platform.x + platform.w / 2).toFixed(1)}" y="${(sy(platform.y) - 6).toFixed(1)}" text-anchor="middle">${index} / ${altitude}m${platform.kind ? ` / ${platform.kind}` : ""}</text>
    </g>`;
  }).join("");

  const routeBands = preview.bands.map((band) => `
    <line x1="${padding}" y1="${altitudeY(band.altitude).toFixed(1)}" x2="${(width - padding).toFixed(1)}" y2="${altitudeY(band.altitude).toFixed(1)}" stroke="rgba(255,255,255,0.16)" stroke-dasharray="6 8" />
    <text x="${padding}" y="${(altitudeY(band.altitude) - 10).toFixed(1)}" class="band">${band.label}</text>
  `).join("");
  const assistZones = preview.id === "team_01_skybase"
    ? [
      { x: 460, y: 1135, w: 1220, h: 560, label: "TEAM BOOST 1" },
      { x: 615, y: 380, w: 1040, h: 560, label: "TEAM BOOST 2" }
    ].map((zone) => `
    <rect x="${sx(zone.x).toFixed(1)}" y="${sy(zone.y).toFixed(1)}" width="${(zone.w * scale).toFixed(1)}" height="${(zone.h * scale).toFixed(1)}" rx="10" fill="#2f4858" opacity="0.34" stroke="#d0ebff" stroke-width="2" stroke-dasharray="8 7" />
    <text x="${sx(zone.x + 28).toFixed(1)}" y="${(sy(zone.y) + 28).toFixed(1)}" class="assist">${zone.label}</text>
  `).join("")
    : "";

  const titleY = offsetY + 30;
  return {
    height: localHeight,
    markup: `
    <text x="${padding}" y="${titleY}" class="title">${preview.title}</text>
    <text x="${padding}" y="${titleY + 26}" class="note">${preview.note}</text>
    ${routeBands}
    ${assistZones}
    <line x1="${sx(stage.spawnX - 950).toFixed(1)}" y1="${sy(metrics.spawnY + stage.playerH).toFixed(1)}" x2="${sx(stage.spawnX + 950).toFixed(1)}" y2="${sy(metrics.spawnY + stage.playerH).toFixed(1)}" stroke="#ffffff" stroke-width="2" opacity="0.2" />
    <text x="${sx(stage.spawnX).toFixed(1)}" y="${(sy(metrics.spawnY + stage.playerH) + 34).toFixed(1)}" text-anchor="middle">START FLOOR / 20人対応</text>
    <text x="${sx(stage.spawnX).toFixed(1)}" y="${(sy(stage.goalY) + 12).toFixed(1)}" text-anchor="middle" class="goal">GOAL</text>
    ${rows}
    `
  };
}

let offsetY = 0;
const rendered = previews.map((preview) => {
  const result = renderStage(preview, offsetY);
  offsetY += result.height + 80;
  return result.markup;
});
const height = offsetY;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" role="img" aria-label="Sky Rush コースプレビュー">
  <style>
    text { fill: #eef7ff; font-size: 13px; font-weight: 700; font-family: system-ui, sans-serif; paint-order: stroke; stroke: #071724; stroke-width: 4px; }
    .title { fill: #ffd166; font-size: 24px; stroke-width: 5px; }
    .note { fill: #bcd1df; font-size: 14px; font-weight: 600; stroke-width: 3px; }
    .band { fill: #9fd8ff; font-size: 15px; }
    .assist { fill: #d0ebff; font-size: 15px; }
    .goal { fill: #ffd166; font-size: 18px; }
  </style>
  <rect width="100%" height="100%" fill="#0f2c40" />
  ${rendered.join("")}
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
  </style>
</head>
<body>
  <header>
    <h1>Sky Rush コースプレビュー</h1>
    <p>バトル4コースとチーム登山1コース。黄色は消える床、紫は伸縮バーです。</p>
  </header>
  ${svg}
</body>
</html>
`;

function clean(content: string) {
  return content.split(/\r?\n/).map((line) => line.trimEnd()).join("\n");
}

writeFileSync("stage-preview.html", clean(html), "utf8");
writeFileSync("stage-preview.svg", clean(`<?xml version="1.0" encoding="UTF-8"?>${svg}`), "utf8");
console.log("Generated stage-preview.html and stage-preview.svg");
