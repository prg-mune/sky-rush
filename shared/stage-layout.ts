import type { GameMode, StageId } from "./types";

export type Platform = {
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: "stretch" | "vanish";
  minW?: number;
  maxW?: number;
  periodMs?: number;
  phaseMs?: number;
  visibleMs?: number;
  hiddenMs?: number;
  active?: boolean;
};

export type StageDefinition = {
  mode: GameMode;
  climbHeight: number;
  platforms: Platform[];
  teamChallengePlatforms: Platform[];
};

export const stage = {
  width: 2200,
  goalY: 160,
  spawnX: 1100,
  gravity: 2100,
  moveSpeed: 360,
  jumpMin: 900,
  jumpMax: 1360,
  playerW: 34,
  playerH: 46
};

export const baseCourse = {
  goalY: 160,
  spawnY: 3950,
  climbHeight: 3790
};

export const stageHeights = {
  beginner: 2000,
  intermediate: 5000,
  advanced: 8000
};

const balancedPlatforms: Platform[] = [
  { x: 520, y: 4060, w: 1160, h: 28 },
  { x: 260, y: 3780, w: 420, h: 24 },
  { x: 980, y: 3780, w: 420, h: 24, kind: "vanish", visibleMs: 2800, hiddenMs: 1200, phaseMs: 0 },
  { x: 1530, y: 3780, w: 360, h: 24 },
  { x: 710, y: 3500, w: 380, h: 24 },
  { x: 1320, y: 3500, w: 380, h: 24 },
  { x: 400, y: 3220, w: 350, h: 24, kind: "vanish", visibleMs: 2600, hiddenMs: 1100, phaseMs: 700 },
  { x: 1040, y: 3220, w: 360, h: 24 },
  { x: 1490, y: 2940, w: 330, h: 24 },
  { x: 700, y: 2940, w: 330, h: 24 },
  { x: 450, y: 2660, w: 320, h: 24 },
  { x: 1060, y: 2660, w: 330, h: 24, kind: "vanish", visibleMs: 2400, hiddenMs: 1200, phaseMs: 1400 },
  { x: 1380, y: 2380, w: 300, h: 24 },
  { x: 760, y: 2380, w: 310, h: 24, kind: "stretch", minW: 150, maxW: 420, periodMs: 3600, phaseMs: 400 },
  { x: 520, y: 2100, w: 290, h: 24, kind: "vanish", visibleMs: 2500, hiddenMs: 1300, phaseMs: 300 },
  { x: 1130, y: 2100, w: 300, h: 24 },
  { x: 860, y: 1820, w: 290, h: 24 },
  { x: 1220, y: 1540, w: 270, h: 24 },
  { x: 750, y: 1540, w: 270, h: 24 },
  { x: 1000, y: 1260, w: 260, h: 24, kind: "vanish", visibleMs: 2300, hiddenMs: 1200, phaseMs: 950 },
  { x: 780, y: 980, w: 240, h: 24, kind: "stretch", minW: 120, maxW: 340, periodMs: 3000, phaseMs: 1200 },
  { x: 1160, y: 980, w: 240, h: 24 },
  { x: 940, y: 700, w: 240, h: 24, kind: "vanish", visibleMs: 2200, hiddenMs: 1100, phaseMs: 1600 },
  { x: 980, y: 420, w: 260, h: 24 }
];

const balancedTeamChallengePlatforms: Platform[] = [
  { x: 875, y: 1720, w: 450, h: 28, kind: "vanish", visibleMs: 3200, hiddenMs: 1200, phaseMs: 500 },
  { x: 990, y: 1120, w: 300, h: 28 },
  { x: 1015, y: 840, w: 250, h: 24 }
];

export const stageDefinitions: Record<StageId, StageDefinition> = {
  battle_01_garden: {
    mode: "battle",
    climbHeight: stageHeights.beginner,
    platforms: balancedPlatforms,
    teamChallengePlatforms: balancedTeamChallengePlatforms
  },
  battle_02_breeze: {
    mode: "battle",
    climbHeight: stageHeights.beginner,
    platforms: balancedPlatforms.map((platform) => {
      if ([3500, 2940].includes(platform.y)) return { ...platform, w: platform.w * 0.9 };
      if ([3220, 2100].includes(platform.y)) return { ...platform, kind: "vanish" as const, visibleMs: 2900, hiddenMs: 900, phaseMs: platform.x };
      return platform;
    }),
    teamChallengePlatforms: []
  },
  battle_03_cloud_jumble: {
    mode: "battle",
    climbHeight: stageHeights.intermediate,
    platforms: [
      ...balancedPlatforms.map((platform) => {
        if ([3780, 3500, 3220, 2940, 2660].includes(platform.y)) return { ...platform, x: platform.x + (platform.x < stage.width / 2 ? -90 : 90), w: platform.w * 0.88 };
        if ([2380, 1540].includes(platform.y)) return { ...platform, kind: "vanish" as const, visibleMs: 2700, hiddenMs: 1100, phaseMs: platform.x };
        return platform;
      }),
      { x: 1010, y: 3360, w: 240, h: 24 },
      { x: 870, y: 2240, w: 230, h: 24 }
    ],
    teamChallengePlatforms: []
  },
  battle_04_sunset_bridge: {
    mode: "battle",
    climbHeight: stageHeights.intermediate,
    platforms: balancedPlatforms.map((platform) => {
      if ([3780, 2940, 2100].includes(platform.y)) return { ...platform, w: platform.w * 1.18 };
      if ([3220, 2660, 1260].includes(platform.y)) return { ...platform, w: platform.w * 0.72, kind: "vanish" as const, visibleMs: 2600, hiddenMs: 1200, phaseMs: platform.x + platform.y };
      return platform;
    }),
    teamChallengePlatforms: []
  },
  battle_05_wobble_highland: {
    mode: "battle",
    climbHeight: stageHeights.intermediate,
    platforms: balancedPlatforms.map((platform) => {
      if ([3780, 2940, 2100, 1540, 700].includes(platform.y)) {
        return { ...platform, kind: "stretch" as const, minW: Math.max(110, platform.w * 0.42), maxW: platform.w * 1.28, periodMs: 2800 + platform.y, phaseMs: platform.x };
      }
      return platform;
    }),
    teamChallengePlatforms: []
  },
  battle_06_phantom_corridor: {
    mode: "battle",
    climbHeight: stageHeights.intermediate,
    platforms: balancedPlatforms.map((platform) => {
      if ([3500, 2940, 2380, 1540].includes(platform.y)) return { ...platform, kind: "vanish" as const, visibleMs: 2200, hiddenMs: 1300, phaseMs: platform.x };
      return platform;
    }),
    teamChallengePlatforms: []
  },
  battle_07_cup_qualifier: {
    mode: "battle",
    climbHeight: stageHeights.intermediate,
    platforms: balancedPlatforms.map((platform) => {
      if ([3780, 2660, 1260].includes(platform.y)) return { ...platform, kind: "vanish" as const, visibleMs: 2300, hiddenMs: 1200, phaseMs: platform.x };
      if ([2940, 1540, 700].includes(platform.y)) return { ...platform, kind: "stretch" as const, minW: Math.max(110, platform.w * 0.48), maxW: platform.w * 1.18, periodMs: 3100 + platform.y, phaseMs: platform.x };
      return platform;
    }),
    teamChallengePlatforms: []
  },
  battle_08_lightning_ridge: {
    mode: "battle",
    climbHeight: stageHeights.advanced,
    platforms: balancedPlatforms.map((platform) => {
      const narrowed = [3780, 3500, 3220, 2940, 2660, 2380, 2100, 1540, 1260, 980, 700].includes(platform.y);
      const next = narrowed ? { ...platform, w: Math.max(190, platform.w * 0.7) } : platform;
      if ([3220, 2660, 2100, 1260, 700].includes(platform.y)) return { ...next, kind: "vanish" as const, visibleMs: 2000, hiddenMs: 1350, phaseMs: platform.x + 400 };
      return next;
    }),
    teamChallengePlatforms: []
  },
  battle_09_stratos_ladder: {
    mode: "battle",
    climbHeight: stageHeights.advanced,
    platforms: [
      ...balancedPlatforms.map((platform) => {
        if ([3780, 3220, 2660, 2100, 1540, 980].includes(platform.y)) return { ...platform, w: Math.max(180, platform.w * 0.62), kind: "vanish" as const, visibleMs: 1900, hiddenMs: 1400, phaseMs: platform.y };
        if ([2940, 2380, 1260, 700].includes(platform.y)) return { ...platform, kind: "stretch" as const, minW: Math.max(100, platform.w * 0.35), maxW: platform.w * 1.12, periodMs: 2600 + platform.y, phaseMs: platform.x };
        return platform;
      }),
      { x: 1090, y: 560, w: 180, h: 24, kind: "vanish" as const, visibleMs: 1800, hiddenMs: 1300, phaseMs: 300 }
    ],
    teamChallengePlatforms: []
  },
  battle_10_everest_rush: {
    mode: "battle",
    climbHeight: stageHeights.advanced,
    platforms: [
      ...balancedPlatforms.map((platform) => {
        if (platform.y === 4060 || platform.y === 420) return platform;
        return { ...platform, w: Math.max(150, platform.w * 0.58), kind: "vanish" as const, visibleMs: 1700, hiddenMs: 1450, phaseMs: platform.x + platform.y };
      }),
      { x: 875, y: 560, w: 170, h: 24, kind: "vanish" as const, visibleMs: 1600, hiddenMs: 1500, phaseMs: 700 },
      { x: 1150, y: 560, w: 170, h: 24, kind: "vanish" as const, visibleMs: 1600, hiddenMs: 1500, phaseMs: 1500 }
    ],
    teamChallengePlatforms: []
  },
  team_01_skybase: {
    mode: "team",
    climbHeight: stageHeights.beginner,
    platforms: balancedPlatforms.filter((platform) => ![1820, 1540, 1260, 980].includes(platform.y)),
    teamChallengePlatforms: [
      { x: 820, y: 1760, w: 520, h: 28, kind: "vanish", visibleMs: 3300, hiddenMs: 1200, phaseMs: 500 },
      { x: 980, y: 1220, w: 310, h: 28, kind: "vanish", visibleMs: 2600, hiddenMs: 1300, phaseMs: 1400 },
      { x: 1020, y: 860, w: 240, h: 24 },
      { x: 940, y: 600, w: 280, h: 24, kind: "stretch", minW: 130, maxW: 360, periodMs: 3200 }
    ]
  }
};

export function normalizeStageId(mode: GameMode, stageId: StageId): StageId {
  const definition = stageDefinitions[stageId];
  if (definition?.mode === mode) return stageId;
  return mode === "team" ? "team_01_skybase" : "battle_01_garden";
}

export function stageMetrics(stageId: StageId) {
  const climbHeight = stageDefinitions[stageId]?.climbHeight ?? stageHeights.beginner;
  return {
    goalY: stage.goalY,
    spawnY: stage.goalY + climbHeight,
    climbHeight
  };
}

export function buildStagePlatforms(platforms: Platform[], climbHeight: number, includeGoalApproach = true) {
  const spawnY = stage.goalY + climbHeight;
  const goalApproachPlatforms: Platform[] = [
    { x: 915, y: stage.goalY + 490, w: 370, h: 24 },
    { x: 980, y: stage.goalY + 260, w: 260, h: 24 }
  ];
  const allowedGoalApproachY = new Set(goalApproachPlatforms.map((platform) => platform.y));
  const goalClearanceBottom = stage.goalY + 520;
  const expanded: Platform[] = [];
  const cycles = Math.ceil((climbHeight + 420) / baseCourse.climbHeight);
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (const platform of platforms) {
      const baseAltitude = baseCourse.spawnY - platform.y;
      if (baseAltitude < -160) continue;
      const altitude = baseAltitude + cycle * baseCourse.climbHeight;
      if (altitude < -160 || altitude > climbHeight - 120) continue;
      const y = spawnY - altitude;
      if (includeGoalApproach && y > stage.goalY && y < goalClearanceBottom && !allowedGoalApproachY.has(y)) continue;
      expanded.push({ ...platform, y, phaseMs: (platform.phaseMs ?? 0) + cycle * 470 });
    }
  }
  if (includeGoalApproach) expanded.push(...goalApproachPlatforms);
  return expanded.sort((a, b) => b.y - a.y);
}

export function stagePlatforms(mode: GameMode, stageId: StageId) {
  const selected = stageDefinitions[normalizeStageId(mode, stageId)];
  const sourcePlatforms = mode === "team" ? selected.platforms.filter((platform) => ![1820, 1540, 1260].includes(platform.y)) : selected.platforms;
  const basePlatforms = buildStagePlatforms(sourcePlatforms, selected.climbHeight);
  if (mode !== "team") return basePlatforms;
  return [
    ...basePlatforms,
    ...buildStagePlatforms(selected.teamChallengePlatforms, selected.climbHeight, false)
  ].sort((a, b) => b.y - a.y);
}

export function currentPlatform(platform: Platform, now: number): Platform {
  if (platform.kind === "vanish") {
    const visibleMs = platform.visibleMs ?? 2600;
    const hiddenMs = platform.hiddenMs ?? 1200;
    const periodMs = visibleMs + hiddenMs;
    const phaseMs = platform.phaseMs ?? 0;
    const elapsed = (now + phaseMs) % periodMs;
    return {
      ...platform,
      active: elapsed < visibleMs
    };
  }
  if (platform.kind !== "stretch") return platform;
  const minW = platform.minW ?? platform.w;
  const maxW = platform.maxW ?? platform.w;
  const periodMs = platform.periodMs ?? 3200;
  const phaseMs = platform.phaseMs ?? 0;
  const t = ((now + phaseMs) % periodMs) / periodMs;
  const eased = (1 - Math.cos(t * Math.PI * 2)) / 2;
  const w = minW + (maxW - minW) * eased;
  return {
    ...platform,
    x: platform.x + platform.w / 2 - w / 2,
    w
  };
}

export function activeCollisionPlatforms(mode: GameMode, stageId: StageId, now: number) {
  return stagePlatforms(mode, stageId)
    .map((platform) => currentPlatform(platform, now))
    .filter((platform) => platform.active !== false);
}

export function courseBoundsAt(y: number, metrics: { spawnY: number; goalY: number }) {
  const climbRatio = Math.max(0, Math.min(1, (metrics.spawnY - y) / (metrics.spawnY - metrics.goalY)));
  const width = 2050 - climbRatio * 1120;
  const center = stage.width / 2;
  return {
    left: center - width / 2,
    right: center + width / 2
  };
}

export function validateStageLayouts() {
  const issues = checkStageLayouts();
  if (issues.length > 0) throw new Error(`Invalid stage layout: ${issues.join(", ")}`);
}

export function checkStageLayouts() {
  const issues: string[] = [];
  const allowedGoalApproachY = new Set([stage.goalY + 490, stage.goalY + 260]);
  const goalClearanceBottom = stage.goalY + 520;
  for (const [stageId, definition] of Object.entries(stageDefinitions) as Array<[StageId, StageDefinition]>) {
    const platforms = stagePlatforms(definition.mode, stageId);
    const blockers = platforms.filter((platform) => platform.y > stage.goalY && platform.y < goalClearanceBottom && !allowedGoalApproachY.has(platform.y));
    if (blockers.length > 0) {
      issues.push(`${stageId}: ${blockers.length} platform(s) inside goal clearance`);
    }
    const reachabilityIssue = checkReachability(stageId, definition.mode, platforms);
    if (reachabilityIssue) issues.push(reachabilityIssue);
  }
  return issues;
}

function checkReachability(stageId: StageId, mode: GameMode, platforms: Platform[]) {
  const metrics = stageMetrics(stageId);
  const maxRise = mode === "team" ? 460 : 370;
  const maxHorizontalGap = mode === "team" ? 720 : 650;
  const nodes = [
    { label: "spawn", x: stage.spawnX - 580, y: metrics.spawnY + 110, w: 1160 },
    ...platforms.map((platform, index) => ({
      label: `${index}:${platform.kind ?? "normal"}@${Math.round(platform.y)}`,
      x: effectiveX(platform),
      y: platform.y,
      w: effectiveWidth(platform)
    })),
    { label: "goal", x: 980, y: stage.goalY, w: 260 }
  ].sort((a, b) => b.y - a.y);
  const startIndex = nodes.findIndex((node) => node.label === "spawn");
  const goalIndex = nodes.findIndex((node) => node.label === "goal");
  const reachable = new Set<number>([startIndex]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let from = 0; from < nodes.length; from += 1) {
      if (!reachable.has(from)) continue;
      for (let to = 0; to < nodes.length; to += 1) {
        if (reachable.has(to)) continue;
        if (canReach(nodes[from], nodes[to], maxRise, maxHorizontalGap)) {
          reachable.add(to);
          changed = true;
        }
      }
    }
  }
  if (reachable.has(goalIndex)) return "";
  const highest = [...reachable].map((index) => nodes[index]).sort((a, b) => a.y - b.y)[0];
  return `${stageId}: goal is not reachable by platform graph (highest reachable ${highest?.label ?? "none"})`;
}

function canReach(from: { x: number; y: number; w: number }, to: { x: number; y: number; w: number }, maxRise: number, maxHorizontalGap: number) {
  const rise = from.y - to.y;
  if (rise <= 0 || rise > maxRise) return false;
  return horizontalGap(from, to) <= maxHorizontalGap;
}

function horizontalGap(a: { x: number; w: number }, b: { x: number; w: number }) {
  if (a.x + a.w < b.x) return b.x - (a.x + a.w);
  if (b.x + b.w < a.x) return a.x - (b.x + b.w);
  return 0;
}

function effectiveWidth(platform: Platform) {
  return platform.kind === "stretch" ? platform.minW ?? platform.w : platform.w;
}

function effectiveX(platform: Platform) {
  const width = effectiveWidth(platform);
  return platform.x + platform.w / 2 - width / 2;
}
