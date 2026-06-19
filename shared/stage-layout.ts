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
    { x: 1220, y: stage.goalY + 490, w: 340, h: 24 },
    { x: 860, y: stage.goalY + 260, w: 280, h: 24 }
  ];
  const allowedGoalApproachY = new Set(goalApproachPlatforms.map((platform) => platform.y));
  const goalClearanceBottom = stage.goalY + 520;
  const maxBaseAltitude = Math.max(...platforms.map((platform) => baseCourse.spawnY - platform.y));
  const playableTopAltitude = includeGoalApproach ? climbHeight - 650 : climbHeight - 260;
  const expanded: Platform[] = [];
  for (const platform of platforms) {
    const baseAltitude = baseCourse.spawnY - platform.y;
    if (baseAltitude < -160) continue;
    const altitude = baseAltitude <= 0
      ? baseAltitude
      : (baseAltitude / maxBaseAltitude) * playableTopAltitude;
    const y = spawnY - altitude;
    if (altitude > climbHeight - 120) continue;
    if (y > stage.goalY && y < goalClearanceBottom && !allowedGoalApproachY.has(y)) continue;
    expanded.push(fitPlatformToCourse({ ...platform, y, phaseMs: platform.phaseMs ?? 0 }, { spawnY, goalY: stage.goalY }));
  }

  const routePlatforms = condensePlatformRows(expanded, climbHeight);
  const connectors = buildVerticalConnectors(routePlatforms, climbHeight, includeGoalApproach);
  const metrics = { spawnY, goalY: stage.goalY };
  if (includeGoalApproach) {
    routePlatforms.push(...goalApproachPlatforms.map((platform) => fitPlatformToCourse(platform, metrics)));
  }
  return loosenStackedPlatforms([...routePlatforms, ...connectors], metrics).sort((a, b) => b.y - a.y);
}

function condensePlatformRows(platforms: Platform[], climbHeight: number) {
  const metrics = { spawnY: stage.goalY + climbHeight, goalY: stage.goalY };
  const groups = new Map<number, Platform[]>();
  for (const platform of platforms) {
    const key = Math.round(platform.y);
    groups.set(key, [...(groups.get(key) ?? []), platform]);
  }
  const sideRouteEvery = climbHeight <= stageHeights.beginner ? Number.POSITIVE_INFINITY : climbHeight <= stageHeights.intermediate ? 5 : 6;
  const routeLanes = [900, 1160, 860, 1120];
  return [...groups.entries()]
    .sort(([a], [b]) => b - a)
    .flatMap(([_, row], rowIndex) => {
      const lane = routeLanes[rowIndex % routeLanes.length];
      const sorted = [...row].sort((a, b) => Math.abs(platformCenter(a) - lane) - Math.abs(platformCenter(b) - lane));
      const selected = [fitRoutePlatform(sorted[0], lane, climbHeight, metrics)];
      const shouldKeepSideRoute = row.length > 1 && rowIndex % sideRouteEvery === sideRouteEvery - 1;
      if (shouldKeepSideRoute) {
        const side = sorted.find((platform) => Math.abs(platformCenter(platform) - lane) > 300);
        if (side) selected.push(side);
      }
      return selected;
    });
}

function fitRoutePlatform(platform: Platform, centerX: number, climbHeight: number, metrics: { spawnY: number; goalY: number }) {
  const maxWidth = climbHeight <= stageHeights.beginner ? 330 : climbHeight <= stageHeights.intermediate ? 300 : 270;
  const w = Math.min(platform.w, maxWidth);
  return fitPlatformToCourse({
    ...platform,
    x: centerX - w / 2,
    w,
    minW: platform.minW ? Math.min(platform.minW, w) : platform.minW,
    maxW: platform.maxW ? Math.min(platform.maxW, Math.max(w, maxWidth)) : platform.maxW
  }, metrics);
}

function fitPlatformToCourse(platform: Platform, metrics: { spawnY: number; goalY: number }): Platform {
  const bounds = courseBoundsAt(platform.y, metrics);
  const margin = 24;
  const maxCourseWidth = Math.max(180, bounds.right - bounds.left - margin * 2);
  const w = Math.min(platform.w, maxCourseWidth);
  const maxW = platform.maxW ? Math.min(platform.maxW, maxCourseWidth) : platform.maxW;
  const minW = platform.minW ? Math.min(platform.minW, maxW ?? maxCourseWidth) : platform.minW;
  const left = bounds.left + margin;
  const right = bounds.right - margin - w;
  const x = Math.max(left, Math.min(platform.x, right));
  return { ...platform, x, w, minW, maxW };
}

function buildVerticalConnectors(platforms: Platform[], climbHeight: number, includeGoalApproach: boolean) {
  const rows = [...new Set(platforms.map((platform) => Math.round(platform.y)))].sort((a, b) => b - a);
  const connectors: Platform[] = [];
  const maxRise = 330;
  for (let index = 0; index < rows.length - 1; index += 1) {
    const fromY = rows[index];
    const toY = rows[index + 1];
    const gap = fromY - toY;
    if (gap <= maxRise) continue;
    const steps = Math.ceil(gap / maxRise);
    for (let step = 1; step < steps; step += 1) {
      const y = fromY - (gap * step) / steps;
      if (includeGoalApproach && y > stage.goalY && y < stage.goalY + 520) continue;
      const ratio = Math.max(0, Math.min(1, (stage.goalY + climbHeight - y) / climbHeight));
      const lane = (index + step) % 3;
      const centerX = lane === 0 ? 900 : lane === 1 ? 1100 : 1260;
      const width = Math.max(210, 300 - ratio * 55);
      connectors.push(fitPlatformToCourse({
        x: centerX - width / 2,
        y,
        w: width,
        h: 24,
        kind: (index + step) % 4 === 0 ? "vanish" : undefined,
        visibleMs: 2700,
        hiddenMs: 900,
        phaseMs: index * 260 + step * 180
      }, { spawnY: stage.goalY + climbHeight, goalY: stage.goalY }));
    }
  }
  return connectors;
}

function loosenStackedPlatforms(platforms: Platform[], metrics: { spawnY: number; goalY: number }) {
  const sorted = [...platforms].sort((a, b) => b.y - a.y);
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const lower = sorted[index];
    const upper = sorted[index + 1];
    const rise = lower.y - upper.y;
    if (rise <= 0 || rise > 340) continue;
    if (exposedHorizontalGap(lower, upper) < Number.POSITIVE_INFINITY) continue;
    const direction = index % 2 === 0 ? 1 : -1;
    const shifted = fitPlatformToCourse({ ...upper, x: upper.x + direction * 110 }, metrics);
    sorted[index + 1] = exposedHorizontalGap(lower, shifted) < Number.POSITIVE_INFINITY
      ? shifted
      : fitPlatformToCourse({ ...upper, x: upper.x - direction * 110 }, metrics);
  }
  return sorted;
}

export function stagePlatforms(mode: GameMode, stageId: StageId) {
  const normalizedStageId = normalizeStageId(mode, stageId);
  const selected = stageDefinitions[normalizedStageId];
  if (normalizedStageId === "battle_01_garden") return gardenPlatforms(selected.climbHeight);
  if (normalizedStageId === "battle_03_cloud_jumble") return cloudJumblePlatforms(selected.climbHeight);
  const sourcePlatforms = mode === "team" ? selected.platforms.filter((platform) => ![1820, 1540, 1260].includes(platform.y)) : selected.platforms;
  const basePlatforms = buildStagePlatforms(sourcePlatforms, selected.climbHeight);
  if (mode !== "team") return basePlatforms;
  return [
    ...basePlatforms,
    ...buildStagePlatforms(selected.teamChallengePlatforms, selected.climbHeight, false)
  ].sort((a, b) => b.y - a.y);
}

function gardenPlatforms(climbHeight: number) {
  const spawnY = stage.goalY + climbHeight;
  const startY = spawnY + stage.playerH;
  const metrics = { spawnY, goalY: stage.goalY };
  const platforms: Platform[] = [
    { x: stage.spawnX - 950, y: startY, w: 1900, h: 30 },

    { x: 260, y: 1935, w: 430, h: 24 },
    { x: 980, y: 1935, w: 430, h: 24, kind: "vanish", visibleMs: 3200, hiddenMs: 900, phaseMs: 200 },

    { x: 760, y: 1690, w: 360, h: 24 },

    { x: 390, y: 1440, w: 360, h: 24, kind: "vanish", visibleMs: 3000, hiddenMs: 1000, phaseMs: 900 },
    { x: 1040, y: 1440, w: 370, h: 24 },
    { x: 1500, y: 1190, w: 330, h: 24 },

    { x: 1070, y: 950, w: 300, h: 24, kind: "stretch", minW: 190, maxW: 390, periodMs: 3600, phaseMs: 700 },

    { x: 760, y: 700, w: 300, h: 24, kind: "vanish", visibleMs: 2800, hiddenMs: 900, phaseMs: 500 },
    { x: 1280, y: 700, w: 300, h: 24, kind: "vanish", visibleMs: 2800, hiddenMs: 900, phaseMs: 1500 },
    { x: 850, y: 420, w: 300, h: 24 }
  ];
  return platforms.map((platform) => fitPlatformToCourse(platform, metrics)).sort((a, b) => b.y - a.y);
}

function cloudJumblePlatforms(climbHeight: number) {
  const spawnY = stage.goalY + climbHeight;
  const startY = spawnY + stage.playerH;
  const metrics = { spawnY, goalY: stage.goalY };
  const platforms: Platform[] = [
    { x: stage.spawnX - 950, y: startY, w: 1900, h: 30 },

    { x: 260, y: 4890, w: 380, h: 24, kind: "vanish", visibleMs: 3100, hiddenMs: 900, phaseMs: 100 },
    { x: 950, y: 4890, w: 390, h: 24 },
    { x: 1560, y: 4890, w: 360, h: 24, kind: "vanish", visibleMs: 3000, hiddenMs: 1000, phaseMs: 900 },

    { x: 650, y: 4560, w: 350, h: 24, kind: "vanish", visibleMs: 2800, hiddenMs: 1100, phaseMs: 400 },
    { x: 1260, y: 4560, w: 360, h: 24 },

    { x: 360, y: 4230, w: 330, h: 24 },
    { x: 1030, y: 4230, w: 340, h: 24, kind: "vanish", visibleMs: 2700, hiddenMs: 1000, phaseMs: 1200 },

    { x: 1410, y: 3900, w: 330, h: 24, kind: "vanish", visibleMs: 2600, hiddenMs: 1200, phaseMs: 500 },
    { x: 760, y: 3900, w: 330, h: 24 },

    { x: 470, y: 3570, w: 320, h: 24, kind: "vanish", visibleMs: 2800, hiddenMs: 1100, phaseMs: 1600 },
    { x: 1110, y: 3570, w: 330, h: 24, kind: "stretch", minW: 210, maxW: 390, periodMs: 3500, phaseMs: 700 },

    { x: 1430, y: 3240, w: 310, h: 24, kind: "vanish", visibleMs: 2500, hiddenMs: 1200, phaseMs: 300 },
    { x: 740, y: 3240, w: 320, h: 24 },

    { x: 520, y: 2910, w: 300, h: 24, kind: "vanish", visibleMs: 2600, hiddenMs: 1200, phaseMs: 1100 },
    { x: 1160, y: 2910, w: 310, h: 24 },

    { x: 1470, y: 2580, w: 300, h: 24, kind: "vanish", visibleMs: 2400, hiddenMs: 1300, phaseMs: 600 },
    { x: 830, y: 2580, w: 300, h: 24, kind: "vanish", visibleMs: 2700, hiddenMs: 1000, phaseMs: 1700 },

    { x: 570, y: 2250, w: 300, h: 24 },
    { x: 1130, y: 2250, w: 300, h: 24, kind: "vanish", visibleMs: 2500, hiddenMs: 1200, phaseMs: 900 },

    { x: 1370, y: 1920, w: 290, h: 24, kind: "vanish", visibleMs: 2400, hiddenMs: 1300, phaseMs: 200 },
    { x: 780, y: 1920, w: 300, h: 24, kind: "stretch", minW: 190, maxW: 360, periodMs: 3300, phaseMs: 1000 },

    { x: 1020, y: 1590, w: 300, h: 24, kind: "vanish", visibleMs: 2600, hiddenMs: 1100, phaseMs: 1500 },
    { x: 610, y: 1260, w: 290, h: 24, kind: "vanish", visibleMs: 2500, hiddenMs: 1200, phaseMs: 800 },
    { x: 1190, y: 1260, w: 290, h: 24 },

    { x: 930, y: 930, w: 300, h: 24, kind: "vanish", visibleMs: 2400, hiddenMs: 1200, phaseMs: 400 },
    { x: 1180, y: 650, w: 320, h: 24 },
    { x: 850, y: 420, w: 300, h: 24 }
  ];
  return platforms.map((platform) => fitPlatformToCourse(platform, metrics)).sort((a, b) => b.y - a.y);
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
    const metrics = stageMetrics(stageId);
    const clippedPlatforms = platforms.filter((platform) => playableWidth(platform, metrics) < effectiveWidth(platform) - 1);
    if (clippedPlatforms.length > 0) {
      issues.push(`${stageId}: ${clippedPlatforms.length} platform(s) too narrow inside course bounds`);
    }
    const denseWindow = densestWindow(platforms);
    if (denseWindow.count > maxPlatformsPerWindow(definition.climbHeight, definition.mode)) {
      issues.push(`${stageId}: too many platforms in one view (${denseWindow.count} near y=${Math.round(denseWindow.y)})`);
    }
    const reachabilityIssue = checkReachability(stageId, definition.mode, platforms);
    if (reachabilityIssue) issues.push(reachabilityIssue);
  }
  return issues;
}

function checkReachability(stageId: StageId, mode: GameMode, platforms: Platform[]) {
  const metrics = stageMetrics(stageId);
  const maxJumpPower = mode === "team" ? stage.jumpMax * 1.25 : stage.jumpMax;
  const nodes = [
    { label: "spawn", x: stage.spawnX - 580, y: metrics.spawnY + 110, w: 1160 },
    ...platforms.map((platform, index) => ({
      label: `${index}:${platform.kind ?? "normal"}@${Math.round(platform.y)}`,
      x: effectiveX(platform, metrics),
      y: platform.y,
      w: playableWidth(platform, metrics)
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
        if (canReach(nodes[from], nodes[to], maxJumpPower)) {
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

function canReach(from: { x: number; y: number; w: number }, to: { x: number; y: number; w: number }, jumpPower: number) {
  const rise = from.y - to.y;
  if (rise <= 0) return false;
  const maxRise = (jumpPower * jumpPower) / (2 * stage.gravity);
  if (rise > maxRise * 0.9) return false;
  const travel = horizontalTravelForRise(rise, jumpPower) * 0.78;
  return exposedHorizontalGap(from, to) <= travel;
}

function horizontalTravelForRise(rise: number, jumpPower: number) {
  const discriminant = jumpPower * jumpPower - 2 * stage.gravity * rise;
  if (discriminant <= 0) return 0;
  const descendingTime = (jumpPower + Math.sqrt(discriminant)) / stage.gravity;
  return stage.moveSpeed * descendingTime;
}

function exposedHorizontalGap(from: { x: number; w: number }, to: { x: number; w: number }) {
  const fromLeft = from.x;
  const fromRight = from.x + from.w;
  const toLeft = to.x;
  const toRight = to.x + to.w;
  if (fromRight < toLeft) return toLeft - fromRight;
  if (toRight < fromLeft) return fromLeft - toRight;

  const exposedLeft = Math.max(toLeft - fromLeft, fromLeft - toLeft);
  const exposedRight = Math.max(fromRight - toRight, toRight - fromRight);
  const safeTakeoffWidth = stage.playerW;
  const candidateGaps: number[] = [];
  if (exposedLeft >= safeTakeoffWidth) candidateGaps.push(0);
  if (exposedRight >= safeTakeoffWidth) candidateGaps.push(0);
  if (candidateGaps.length > 0) return 0;
  return Number.POSITIVE_INFINITY;
}

function densestWindow(platforms: Platform[]) {
  const windowHeight = 620;
  let best = { count: 0, y: 0 };
  for (const platform of platforms) {
    const count = platforms.filter((candidate) => Math.abs(candidate.y - platform.y) <= windowHeight / 2).length;
    if (count > best.count) best = { count, y: platform.y };
  }
  return best;
}

function maxPlatformsPerWindow(climbHeight: number, mode: GameMode) {
  if (mode === "team") return 6;
  if (climbHeight <= stageHeights.beginner) return 6;
  if (climbHeight <= stageHeights.intermediate) return 5;
  return 4;
}

function effectiveWidth(platform: Platform) {
  return platform.kind === "stretch" ? platform.minW ?? platform.w : platform.w;
}

function platformCenter(platform: Platform) {
  return platform.x + platform.w / 2;
}

function effectiveX(platform: Platform, metrics: { spawnY: number; goalY: number }) {
  const width = effectiveWidth(platform);
  const x = platform.x + platform.w / 2 - width / 2;
  return Math.max(x, courseBoundsAt(platform.y, metrics).left);
}

function playableWidth(platform: Platform, metrics: { spawnY: number; goalY: number }) {
  const width = effectiveWidth(platform);
  const x = platform.x + platform.w / 2 - width / 2;
  const bounds = courseBoundsAt(platform.y, metrics);
  return Math.max(0, Math.min(x + width, bounds.right) - Math.max(x, bounds.left));
}
