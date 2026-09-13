import { createServer } from "http";
import next from "next";
import { Server, type Socket as IOSocket } from "socket.io";
import type {
  ClientInput,
  ClientToServerEvents,
  DifficultyMode,
  EffectBurst,
  GameMode,
  PlayerSnapshot,
  ResultRow,
  RoomState,
  RoomSummary,
  ServerToClientEvents,
  StageId
} from "../shared/types";
import {
  courseBoundsAt,
  currentPlatform,
  normalizeStageId,
  stage,
  stageMetrics,
  stagePlatforms,
  type Platform,
  validateStageLayouts
} from "../shared/stage-layout";

type SocketData = {
  playerName?: string;
  roomId?: string;
  sessionId?: string;
};

type CpuLevel = "weak" | "strong";

type PlayerRuntime = PlayerSnapshot & {
  socketId: string;
  sessionId?: string;
  input: ClientInput;
  lastJumpRequestId: number;
  chargeStartedAt?: number;
  jumpPressWasActionable: boolean;
  onGround: boolean;
  standingOnPlayerId: string | null;
  standingOnPlatformIndex: number | null;
  wallTouch: "left" | "right" | null;
  aiTargetX?: number;
  aiTakeoffX?: number;
  aiTargetPlatformIndex?: number;
  aiTargetLandingRatio?: number;
  aiPlannedJumpHeldMs?: number;
  aiSteerAt?: number;
  aiNextThinkAt?: number;
  aiNextJumpAt?: number;
  aiLevel?: CpuLevel;
  aiSkill: number;
  lastPushEffectAt: number;
  lastInputAt: number;
  disconnectedAt?: number;
};

type RoomRuntime = Omit<RoomState, "players"> & {
  players: Map<string, PlayerRuntime>;
};

type SkyRushServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type SkyRushSocket = IOSocket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
const PASSWORD = "progress4649";
const PORT = Number(process.env.PORT || 3000);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
const rooms = new Map<string, RoomRuntime>();

const CPU_TARGET_PLAYERS = 20;
const COUNTDOWN_MS = 5000;
const DISCONNECTED_PLAYER_TTL_MS = 2 * 60 * 1000;
const EMPTY_ROOM_TTL_MS = 30 * 1000;
const PLAYER_COLORS = ["#ff6b6b", "#4dabf7", "#51cf66", "#ffd43b", "#da77f2", "#20c997", "#ff922b", "#f06595"];
const STAGE_TIMEOUT_MS: Record<StageId, number> = {
  battle_01_garden: 3 * 60 * 1000,
  battle_02_breeze: 3 * 60 * 1000,
  battle_03_cloud_jumble: 6 * 60 * 1000,
  battle_04_sunset_bridge: 6 * 60 * 1000,
  battle_05_wobble_highland: 6 * 60 * 1000,
  battle_06_phantom_corridor: 6 * 60 * 1000,
  battle_07_cup_qualifier: 6 * 60 * 1000,
  battle_08_lightning_ridge: 10 * 60 * 1000,
  battle_09_stratos_ladder: 10 * 60 * 1000,
  battle_10_everest_rush: 10 * 60 * 1000,
  team_01_skybase: 4 * 60 * 1000
};

function roomSnapshot(room: RoomRuntime): RoomState {
  return {
    ...room,
    serverTime: Date.now(),
    players: [...room.players.values()].map(({ input, onGround, chargeStartedAt, jumpPressWasActionable, standingOnPlayerId, standingOnPlatformIndex, wallTouch, socketId, sessionId, aiTargetX, aiTakeoffX, aiTargetPlatformIndex, aiTargetLandingRatio, aiPlannedJumpHeldMs, aiSteerAt, aiNextThinkAt, aiNextJumpAt, aiLevel, aiSkill, lastPushEffectAt, lastInputAt, disconnectedAt, ...player }) => ({
      ...player,
      grounded: onGround
    }))
  };
}

function roomSummary(room: RoomRuntime): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    mode: room.mode,
    difficulty: room.difficulty,
    stageId: room.stageId,
    playerCount: room.players.size,
    maxPlayers: room.maxPlayers,
    started: room.started
  };
}

function results(room: RoomRuntime): ResultRow[] {
  return [...room.players.values()]
    .sort((a, b) => {
      if (a.finishedAt && b.finishedAt) return a.finishedAt - b.finishedAt;
      if (a.finishedAt) return -1;
      if (b.finishedAt) return 1;
      return b.altitude - a.altitude;
    })
    .map((player, index) => ({
      rank: index + 1,
      playerName: player.name,
      altitude: Math.round(player.altitude),
      goalTimeMs: player.finishedAt && room.startedAt ? player.finishedAt - room.startedAt : undefined,
      team: player.team
    }));
}

function makePlayer(socketId: string, name: string, index: number, mode: GameMode, spawnY: number, isCpu = false, preferredTeam?: number, sessionId?: string, aiLevel?: CpuLevel): PlayerRuntime {
  const now = Date.now();
  return {
    id: socketId,
    socketId,
    sessionId,
    name,
    x: spawnXFor(index),
    y: spawnY,
    vx: 0,
    vy: 0,
    facing: "right",
    jumping: false,
    altitude: 0,
    connected: true,
    isCpu,
    team: mode === "team" ? preferredTeam ?? (index % 4) + 1 : undefined,
    color: isCpu ? "#9aa6b2" : PLAYER_COLORS[index % PLAYER_COLORS.length],
    input: { left: false, right: false, jump: false, jumpHeldMs: 0, jumpRequestId: 0, seq: 0 },
    lastJumpRequestId: 0,
    jumpPressWasActionable: false,
    onGround: false,
    standingOnPlayerId: null,
    standingOnPlatformIndex: null,
    wallTouch: null,
    aiLevel,
    aiSkill: !isCpu ? 1 : aiLevel === "strong" ? 0.9 + Math.random() * 0.08 : 0.72 + Math.random() * 0.12,
    lastPushEffectAt: 0,
    lastInputAt: now
  };
}

function broadcastRooms(io: SkyRushServer) {
  io.emit("rooms", [...rooms.values()].map(roomSummary));
}

function stageTimeoutMs(stageId: StageId) {
  return STAGE_TIMEOUT_MS[stageId] ?? 6 * 60 * 1000;
}

function humanPlayers(room: RoomRuntime) {
  return [...room.players.values()].filter((player) => !player.isCpu);
}

function roomWinner(room: RoomRuntime) {
  return [...humanPlayers(room)].sort((a, b) => {
    if (a.finishedAt && b.finishedAt) return a.finishedAt - b.finishedAt;
    if (a.finishedAt) return -1;
    if (b.finishedAt) return 1;
    return b.altitude - a.altitude;
  })[0];
}

function checkRoomEnd(io: SkyRushServer, room: RoomRuntime) {
  if (room.finishedAt || !room.startedAt) return;
  const humans = humanPlayers(room);
  if (humans.length > 0 && humans.every((player) => Boolean(player.finishedAt))) {
    finishRoom(io, room, "allHumansFinished");
    return;
  }
  if (room.timeoutAt && Date.now() >= room.timeoutAt) {
    finishRoom(io, room, "timeout");
  }
}

function finishRoom(io: SkyRushServer, room: RoomRuntime, reason: RoomState["finishReason"]) {
  if (room.finishedAt) return;
  const winner = roomWinner(room);
  room.winnerId = winner?.id;
  room.winningTeam = winner?.team;
  room.finishedAt = Date.now();
  room.finishReason = reason;
  io.to(room.id).emit("gameEnded", { room: roomSnapshot(room), results: results(room) });
  broadcastRooms(io);
}

function stepPhysics(io: SkyRushServer, dt: number) {
  for (const room of rooms.values()) {
    if (!room.started || room.finishedAt) continue;
    const metrics = stageMetrics(room.stageId);
    const now = Date.now();
    if (room.startedAt && now < room.startedAt) {
      io.to(room.id).emit("gameState", roomSnapshot(room));
      continue;
    }
    const collisionPlatforms = indexedCollisionPlatforms(room, now);
    const previousPlatforms = indexedCollisionPlatforms(room, now - dt * 1000);
    for (const player of room.players.values()) {
      if (!player.connected) continue;
      if (player.finishedAt) {
        player.vx = 0;
        player.vy = 0;
        player.jumping = false;
        continue;
      }
      if (player.isCpu) updateCpuInput(player, room);

      if (player.onGround && player.standingOnPlatformIndex !== null) {
        const current = collisionPlatforms.find((entry) => entry.index === player.standingOnPlatformIndex)?.platform;
        const previous = previousPlatforms.find((entry) => entry.index === player.standingOnPlatformIndex)?.platform;
        if (current?.kind === "moving" && previous) player.x += current.x - previous.x;
      }

      const input = player.input;
      const move = Number(input.right) - Number(input.left);
      player.vx = move * stage.moveSpeed;
      if (move < 0) player.facing = "left";
      if (move > 0) player.facing = "right";

      const requestedJump = input.jumpRequestId !== player.lastJumpRequestId;
      if (requestedJump && (player.onGround || player.wallTouch)) {
        player.lastJumpRequestId = input.jumpRequestId;
        const standingOn = player.standingOnPlayerId ? room.players.get(player.standingOnPlayerId) : undefined;
        const sameTeamBoost = room.mode === "team" && standingOn && player.team && player.team === standingOn.team;
        const stompBoost = standingOn ? (sameTeamBoost ? 1.38 : 1.08) : 1;
        const jumpPower = Math.min(stage.jumpMax, stage.jumpMin + Math.min(input.jumpHeldMs, 650) * 0.8) * stompBoost;
        player.vy = -Math.min(stage.jumpMax * 1.45, jumpPower);
        player.jumping = true;
        if (player.wallTouch === "left") player.vx = stage.moveSpeed * 1.25;
        if (player.wallTouch === "right") player.vx = -stage.moveSpeed * 1.25;
        if (standingOn) emitEffect(io, room, { kind: "jump", x: player.x + stage.playerW / 2, y: player.y + stage.playerH });
      } else if (requestedJump) {
        player.lastJumpRequestId = input.jumpRequestId;
      }

      const previousY = player.y;
      player.vy += stage.gravity * dt;
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      player.wallTouch = null;
      player.onGround = false;
      player.standingOnPlayerId = null;
      player.standingOnPlatformIndex = null;

      const bounds = courseBoundsAt(player.y, metrics);
      if (player.x < bounds.left) {
        player.x = bounds.left;
        player.wallTouch = "left";
      }
      if (player.x > bounds.right - stage.playerW) {
        player.x = bounds.right - stage.playerW;
        player.wallTouch = "right";
      }

      for (const { platform, index: platformIndex } of collisionPlatforms) {
        const platformMargin = platform.kind === "stretch" ? 14 : 0;
        const withinX = player.x + stage.playerW > platform.x - platformMargin && player.x < platform.x + platform.w + platformMargin;
        const previousBottom = previousY + stage.playerH;
        const currentBottom = player.y + stage.playerH;
        const platformBottom = platform.y + platform.h;
        const topGrace = platform.kind === "stretch" ? 10 : 0;
        const landedOnTop = player.vy >= 0 && withinX && previousBottom <= platform.y + topGrace && currentBottom >= platform.y;
        const hitUnderside = player.vy < 0 && withinX && previousY >= platformBottom && player.y <= platformBottom;
        if (landedOnTop) {
          player.y = platform.y - stage.playerH;
          player.vy = 0;
          player.onGround = true;
          player.jumping = false;
          player.standingOnPlatformIndex = platformIndex;
        } else if (hitUnderside) {
          player.y = platformBottom;
          player.vy = 140;
        }
      }

      for (const other of room.players.values()) {
        if (other.id === player.id) continue;
        if (!other.connected) continue;
        const landingOnPlayer =
          player.vy > 0 &&
          player.x + stage.playerW > other.x &&
          player.x < other.x + stage.playerW &&
          player.y + stage.playerH >= other.y &&
          player.y + stage.playerH <= other.y + 16;
        if (landingOnPlayer) {
          player.y = other.y - stage.playerH;
          player.vy = 0;
          player.onGround = true;
          player.jumping = false;
          player.standingOnPlayerId = other.id;
        }
      }

      if (player.input.jump) {
        if (player.onGround && !player.jumpPressWasActionable) {
          player.chargeStartedAt = Date.now();
          player.jumpPressWasActionable = true;
        } else if (player.wallTouch && !player.jumpPressWasActionable) {
          player.chargeStartedAt = undefined;
          player.jumpPressWasActionable = true;
        } else if (!player.onGround && !player.wallTouch) {
          player.chargeStartedAt = undefined;
          player.jumpPressWasActionable = false;
        }
      }

      if (player.y > metrics.spawnY + 460) {
        player.x = spawnXFor(Number(player.id.replace(/\D/g, "").slice(-2)) || 0);
        player.y = metrics.spawnY;
        player.vx = 0;
        player.vy = 0;
        player.standingOnPlatformIndex = null;
      }

      player.altitude = Math.max(0, metrics.spawnY - player.y);
      if (player.y <= metrics.goalY && !player.finishedAt) {
        player.finishedAt = Date.now();
        player.y = metrics.goalY - stage.playerH;
        player.vx = 0;
        player.vy = 0;
        player.jumping = false;
      }
    }
    resolvePlayerPushes(io, room);
    checkRoomEnd(io, room);
    io.to(room.id).emit("gameState", roomSnapshot(room));
  }
}

app.prepare().then(() => {
  validateStageLayouts();
  const httpServer = createServer((req, res) => handle(req, res));
  const io: SkyRushServer = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket"]
  });

  io.on("connection", (socket) => {
    socket.on("login", ({ playerName, password, sessionId }, cb) => {
      if (password !== PASSWORD) return cb(false, "パスワードが違います");
      const trimmed = playerName.trim().slice(0, 16);
      if (!trimmed) return cb(false, "プレイヤー名を入力してください");
      socket.data.playerName = trimmed;
      socket.data.sessionId = sanitizeSessionId(sessionId) || createSessionId();
      cb(true, undefined, socket.data.sessionId);
      socket.emit("rooms", [...rooms.values()].map(roomSummary));
      reconnectPlayer(io, socket);
    });

    socket.on("listRooms", () => socket.emit("rooms", [...rooms.values()].map(roomSummary)));

    socket.on("createRoom", ({ name, mode, difficulty, maxPlayers, stageId }) => {
      if (!socket.data.playerName) return socket.emit("errorMessage", "ログインしてください");
      const id = `room-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const normalizedStageId = normalizeStageId(mode, stageId);
      const room: RoomRuntime = {
        id,
        name: name.trim().slice(0, 24) || `${socket.data.playerName}の部屋`,
        mode,
        difficulty: normalizeDifficulty(difficulty),
        stageId: normalizedStageId,
        maxPlayers: Math.max(2, Math.min(20, maxPlayers)),
        ownerId: socket.id,
        started: false,
        serverTime: Date.now(),
        players: new Map()
      };
      rooms.set(id, room);
      joinRoom(io, socket, room);
      broadcastRooms(io);
    });

    socket.on("joinRoom", (roomId) => {
      const room = rooms.get(roomId);
      if (!room) return socket.emit("errorMessage", "部屋が見つかりません");
      if (room.players.size >= room.maxPlayers) return socket.emit("errorMessage", "部屋が満員です");
      if (room.started) return socket.emit("errorMessage", "開始済みの部屋です");
      joinRoom(io, socket, room);
      broadcastRooms(io);
    });

    socket.on("leaveRoom", () => leaveRoom(io, socket));

    socket.on("setTeam", (team) => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const player = room?.players.get(socket.id);
      if (!room || !player || room.mode !== "team" || room.started || player.isCpu) return;
      player.team = Math.max(1, Math.min(4, Math.round(team)));
      io.to(room.id).emit("roomState", roomSnapshot(room));
    });

    socket.on("setColor", (color) => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const player = room?.players.get(socket.id);
      if (!room || !player || room.started || player.isCpu) return;
      const nextColor = sanitizePlayerColor(color);
      if (!nextColor) return;
      player.color = nextColor;
      io.to(room.id).emit("roomState", roomSnapshot(room));
    });

    socket.on("startGame", () => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      if (!room || room.ownerId !== socket.id) return;
      addCpuPlayers(room, Math.min(room.maxPlayers, CPU_TARGET_PLAYERS) - room.players.size);
      room.started = true;
      room.startedAt = Date.now() + COUNTDOWN_MS;
      room.timeLimitMs = stageTimeoutMs(room.stageId);
      room.timeoutAt = room.startedAt + room.timeLimitMs;
      io.to(room.id).emit("gameStarted", roomSnapshot(room));
      broadcastRooms(io);
    });

    socket.on("input", (input) => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const player = room?.players.get(socket.id);
      if (player && player.connected && input.seq >= player.input.seq) {
        const now = Date.now();
        if (room?.startedAt && now < room.startedAt) {
          player.chargeStartedAt = undefined;
          player.jumpPressWasActionable = false;
          player.input = {
            ...input,
            jump: false,
            jumpHeldMs: 0,
            jumpRequestId: player.input.jumpRequestId
          };
          player.lastInputAt = now;
          return;
        }
        const pressed = input.jump && !player.input.jump;
        const released = !input.jump && player.input.jump;
        if (pressed) {
          player.jumpPressWasActionable = player.onGround || Boolean(player.wallTouch);
          player.chargeStartedAt = player.onGround ? now : undefined;
        }

        let acceptedJumpRequestId = player.input.jumpRequestId;
        let groundedChargeMs = player.chargeStartedAt ? now - player.chargeStartedAt : 0;
        if (released) {
          if (player.jumpPressWasActionable) acceptedJumpRequestId = input.jumpRequestId;
          groundedChargeMs = player.chargeStartedAt ? now - player.chargeStartedAt : 0;
          player.chargeStartedAt = undefined;
          player.jumpPressWasActionable = false;
        }

        player.input = {
          ...input,
          jumpHeldMs: Math.max(0, Math.min(650, groundedChargeMs)),
          jumpRequestId: acceptedJumpRequestId
        };
        player.lastInputAt = now;
      }
    });

    socket.on("disconnect", () => leaveRoom(io, socket, true));
  });

  setInterval(() => stepPhysics(io, 1 / 30), 1000 / 30);
  setInterval(() => cleanupRooms(io), 10 * 1000);
  httpServer.listen(PORT, () => console.log(`Sky Rush listening on http://localhost:${PORT}`));
});

function createSessionId() {
  return `sr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function sanitizeSessionId(sessionId?: string) {
  if (!sessionId) return "";
  const trimmed = sessionId.trim();
  return /^[a-zA-Z0-9_-]{12,80}$/.test(trimmed) ? trimmed : "";
}

function reconnectPlayer(io: SkyRushServer, socket: SkyRushSocket) {
  const sessionId = socket.data.sessionId;
  if (!sessionId) return false;
  for (const room of rooms.values()) {
    const entry = [...room.players.entries()].find(([, player]) => !player.isCpu && !player.connected && player.sessionId === sessionId);
    if (!entry) continue;
    const [oldId, player] = entry;
    room.players.delete(oldId);
    player.id = socket.id;
    player.socketId = socket.id;
    player.name = socket.data.playerName || player.name;
    player.connected = true;
    player.disconnectedAt = undefined;
    player.input = { left: false, right: false, jump: false, jumpHeldMs: 0, jumpRequestId: 0, seq: 0 };
    player.chargeStartedAt = undefined;
    player.jumpPressWasActionable = false;
    player.lastInputAt = Date.now();
    room.players.set(socket.id, player);
    if (room.ownerId === oldId) room.ownerId = socket.id;
    socket.join(room.id);
    socket.data.roomId = room.id;
    io.to(room.id).emit("roomState", roomSnapshot(room));
    broadcastRooms(io);
    return true;
  }
  return false;
}

function joinRoom(
  io: SkyRushServer,
  socket: SkyRushSocket,
  room: RoomRuntime
) {
  leaveRoom(io, socket);
  socket.join(room.id);
  socket.data.roomId = room.id;
  room.players.set(socket.id, makePlayer(socket.id, socket.data.playerName || "Player", room.players.size, room.mode, stageMetrics(room.stageId).spawnY, false, nextHumanTeam(room), socket.data.sessionId));
  io.to(room.id).emit("roomState", roomSnapshot(room));
}

function leaveRoom(io: SkyRushServer, socket: Pick<SkyRushSocket, "id" | "data" | "leave">, disconnected = false) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;
  if (disconnected && room.started && !room.finishedAt) {
    const player = room.players.get(socket.id);
    if (player) {
      player.connected = false;
      player.disconnectedAt = Date.now();
      player.input = { left: false, right: false, jump: false, jumpHeldMs: 0, jumpRequestId: player.input.seq + 1, seq: player.input.seq + 1 };
      player.chargeStartedAt = undefined;
      player.jumpPressWasActionable = false;
    }
  } else {
    room.players.delete(socket.id);
    socket.leave(roomId);
  }
  socket.data.roomId = undefined;
  const humanPlayers = [...room.players.values()].filter((player) => !player.isCpu);
  if (humanPlayers.length === 0) rooms.delete(roomId);
  else {
    const connectedOwner = humanPlayers.find((player) => player.connected) ?? humanPlayers[0];
    if (room.ownerId === socket.id || !room.players.get(room.ownerId)?.connected) room.ownerId = connectedOwner.id;
    io.to(room.id).emit("roomState", roomSnapshot(room));
  }
  broadcastRooms(io);
}

function cleanupRooms(io: SkyRushServer) {
  const now = Date.now();
  let changed = false;
  for (const [roomId, room] of rooms.entries()) {
    for (const [playerId, player] of room.players.entries()) {
      if (player.isCpu || player.connected || !player.disconnectedAt) continue;
      if (now - player.disconnectedAt > DISCONNECTED_PLAYER_TTL_MS) {
        room.players.delete(playerId);
        changed = true;
      }
    }

    const humanPlayers = [...room.players.values()].filter((player) => !player.isCpu);
    const connectedHumans = humanPlayers.filter((player) => player.connected);
    if (humanPlayers.length === 0 || (connectedHumans.length === 0 && (!room.finishedAt || now - room.finishedAt > EMPTY_ROOM_TTL_MS))) {
      rooms.delete(roomId);
      changed = true;
      continue;
    }
    if (!room.players.get(room.ownerId)?.connected) {
      room.ownerId = connectedHumans[0]?.id ?? humanPlayers[0]?.id ?? room.ownerId;
      changed = true;
    }
  }
  if (changed) {
    for (const room of rooms.values()) io.to(room.id).emit("roomState", roomSnapshot(room));
    broadcastRooms(io);
  }
}

function addCpuPlayers(room: RoomRuntime, count: number) {
  const roomForId = room.id.replace(/[^a-zA-Z0-9]/g, "");
  for (let i = 0; i < count && room.players.size < room.maxPlayers; i += 1) {
    const cpuNumber = [...room.players.values()].filter((player) => player.isCpu).length + 1;
    const id = `cpu-${roomForId}-${cpuNumber}`;
    const aiLevel: CpuLevel = cpuNumber % 2 === 0 ? "strong" : "weak";
    const levelLabel = aiLevel === "strong" ? "強" : "弱";
    room.players.set(id, makePlayer(id, `CPU ${cpuNumber} ${levelLabel}`, room.players.size, room.mode, stageMetrics(room.stageId).spawnY, true, undefined, undefined, aiLevel));
  }
}

function nextHumanTeam(room: RoomRuntime) {
  if (room.mode !== "team") return undefined;
  const counts = [1, 2, 3, 4].map((team) => ({
    team,
    count: [...room.players.values()].filter((player) => !player.isCpu && player.team === team).length
  }));
  return counts.sort((a, b) => a.count - b.count || a.team - b.team)[0].team;
}

function sanitizePlayerColor(color: string) {
  const normalized = color.trim().toLowerCase();
  return PLAYER_COLORS.includes(normalized) ? normalized : "";
}

function normalizeDifficulty(difficulty: DifficultyMode): DifficultyMode {
  return difficulty === "hard" ? "hard" : "normal";
}

type CpuRoutePlan = {
  platformIndex: number;
  takeoffCenterX: number;
  landingCenterX: number;
  landingRatio: number;
  minLandingCenterX: number;
  maxLandingCenterX: number;
  jumpHeldMs: number;
  score: number;
};

const CPU_LANDING_GRACE_MS = 220;
const CPU_GOAL_INDEX = -1;
const CPU_GOAL_PLATFORM: Platform = { x: 980, y: stage.goalY + stage.playerH, w: 260, h: 1 };

function updateCpuInput(player: PlayerRuntime, room: RoomRuntime) {
  if (player.aiLevel === "strong") {
    updateStrongCpuInput(player, room);
  } else {
    updateWeakCpuInput(player, room);
  }
}

function updateWeakCpuInput(player: PlayerRuntime, room: RoomRuntime) {
  const now = Date.now();
  const coursePlatforms = activePlatforms(room);
  const nearbyPlatforms = coursePlatforms
    .filter((platform) => platform.y < player.y - 50 && platform.y > player.y - 470)
    .sort((a, b) => b.y - a.y);
  const nearestCenter = stage.width / 2;
  const target =
    nearbyPlatforms
      .map((platform) => ({
        platform,
        score: Math.abs(platform.x + platform.w / 2 - (player.x + stage.playerW / 2)) + Math.abs(platform.x + platform.w / 2 - nearestCenter) * (0.45 - player.aiSkill * 0.25)
      }))
      .sort((a, b) => a.score - b.score)[0]?.platform ||
    coursePlatforms.filter((platform) => platform.y < player.y - 30).sort((a, b) => b.y - a.y)[0] ||
    coursePlatforms[coursePlatforms.length - 1];
  if (!target) return;
  const targetCenter = target.x + target.w / 2;

  if (!player.aiNextThinkAt || now >= player.aiNextThinkAt) {
    const error = (1 - player.aiSkill) * 180;
    player.aiTargetX = targetCenter + Math.random() * error * 2 - error;
    player.aiNextThinkAt = now + 180 + Math.random() * 320;
  }

  const desiredX = player.aiTargetX ?? targetCenter;
  const deltaX = desiredX - (player.x + stage.playerW / 2);
  player.input.left = deltaX < -18;
  player.input.right = deltaX > 18;
  player.input.jump = false;

  const closeEnough = Math.abs(deltaX) < 150 + player.aiSkill * 60;
  const canJump = !player.aiNextJumpAt || now >= player.aiNextJumpAt;
  if (canJump && ((player.onGround && closeEnough) || player.wallTouch)) {
    const verticalGap = Math.max(220, player.y - target.y);
    const teamAssist = room.mode === "team" && player.team && [...room.players.values()].some((other) => other.id !== player.id && other.team === player.team && Math.abs(other.x - player.x) < 180 && Math.abs(other.y - player.y) < 180);
    player.input.jumpHeldMs = Math.min(650, 330 + verticalGap * 0.62 + Math.random() * 90 + (teamAssist ? 90 : 0));
    player.input.jumpRequestId += 1;
    player.aiNextJumpAt = now + 560 + Math.random() * 260;
  }

  player.input.seq += 1;
}

function updateStrongCpuInput(player: PlayerRuntime, room: RoomRuntime) {
  const now = Date.now();
  if (!player.aiNextThinkAt || now >= player.aiNextThinkAt) {
    const lockedPlatform = player.aiTargetPlatformIndex === undefined ? undefined : cpuTargetPlatform(room, player.aiTargetPlatformIndex);
    const remainingFlightMs = lockedPlatform && !player.onGround ? cpuRemainingFlightMs(player, lockedPlatform.y) : 0;
    if (lockedPlatform && remainingFlightMs) {
      const predicted = currentPlatform(lockedPlatform, now + remainingFlightMs);
      const landingRange = cpuLandingRange(predicted);
      const ratio = player.aiTargetLandingRatio ?? 0.5;
      player.aiTargetX = clamp(predicted.x + predicted.w * ratio, landingRange.min, landingRange.max);
      player.aiNextThinkAt = now + 80;
    } else {
      const plan = planCpuRoute(player, room, now);
      if (plan) {
        const error = (1 - player.aiSkill) * 100;
        player.aiTargetX = clamp(plan.landingCenterX + Math.random() * error * 2 - error, plan.minLandingCenterX, plan.maxLandingCenterX);
        player.aiTakeoffX = plan.takeoffCenterX;
        player.aiTargetPlatformIndex = plan.platformIndex;
        player.aiTargetLandingRatio = plan.landingRatio;
        player.aiPlannedJumpHeldMs = plan.jumpHeldMs;
      } else {
        player.aiTargetX = undefined;
        player.aiTakeoffX = undefined;
        player.aiTargetPlatformIndex = undefined;
        player.aiTargetLandingRatio = undefined;
        player.aiPlannedJumpHeldMs = undefined;
      }
      player.aiNextThinkAt = now + 110 + Math.random() * 190;
    }
  }

  const holdTakeoffLine = player.onGround || Boolean(player.aiSteerAt && now < player.aiSteerAt);
  const desiredX = (holdTakeoffLine ? player.aiTakeoffX : player.aiTargetX) ?? player.x + stage.playerW / 2;
  const deltaX = desiredX - (player.x + stage.playerW / 2);
  player.input.left = deltaX < -18;
  player.input.right = deltaX > 18;
  player.input.jump = false;

  const closeEnough = Math.abs(deltaX) < 28 + player.aiSkill * 18;
  const canJump = !player.aiNextJumpAt || now >= player.aiNextJumpAt;
  const targetIndex = player.aiTargetPlatformIndex;
  const target = targetIndex === undefined ? undefined : cpuTargetPlatform(room, targetIndex);
  const jumpHeldMs = player.aiPlannedJumpHeldMs ?? 500;
  const verticalGap = target ? player.y + stage.playerH - target.y : 0;
  const jumpTiming = cpuJumpTiming(verticalGap, jumpHeldMs);
  const flightMs = jumpTiming?.flightMs ?? 0;
  const targetReady = Boolean(target && flightMs && cpuPlatformSafeAt(target, now + flightMs));
  if (canJump && targetReady && ((player.onGround && closeEnough) || player.wallTouch)) {
    const teamAssist = room.mode === "team" && player.team && [...room.players.values()].some((other) => other.id !== player.id && other.team === player.team && Math.abs(other.x - player.x) < 180 && Math.abs(other.y - player.y) < 180);
    const chargeError = (1 - player.aiSkill) * 55 * (Math.random() * 2 - 1);
    player.input.jumpHeldMs = clamp(jumpHeldMs + chargeError + (teamAssist ? 90 : 0), 280, 650);
    player.input.jumpRequestId += 1;
    player.aiSteerAt = now + (jumpTiming?.ascentMs ?? 0) + 45;
    player.aiNextJumpAt = now + 560 + Math.random() * 260;
    player.aiNextThinkAt = now + 180;
  } else if (canJump && target && !targetReady) {
    player.aiNextThinkAt = now;
  }

  player.input.seq += 1;
}

function planCpuRoute(player: PlayerRuntime, room: RoomRuntime, now: number): CpuRoutePlan | undefined {
  const platforms = stagePlatforms(room.mode, room.stageId);
  const sourceY = player.y + stage.playerH;
  const playerCenterX = player.x + stage.playerW / 2;
  const sourcePlatform = player.standingOnPlatformIndex === null ? undefined : platforms[player.standingOnPlatformIndex];
  const sourceRange = sourcePlatform ? cpuLandingRange(currentPlatform(sourcePlatform, now)) : { min: playerCenterX - 20, max: playerCenterX + 20 };
  const routeTargets = [
    ...platforms.map((platform, platformIndex) => ({ platform, platformIndex })),
    { platform: CPU_GOAL_PLATFORM, platformIndex: CPU_GOAL_INDEX }
  ];
  const plans = routeTargets.flatMap(({ platform, platformIndex }) => {
    const jump = cpuJumpPlan(sourceY - platform.y);
    if (!jump) return [];
    const landingAt = now + jump.flightMs;
    const predicted = currentPlatform(platform, landingAt);
    if (!cpuPlatformSafeAt(platform, landingAt)) return [];

    const followUp = platformIndex === CPU_GOAL_INDEX ? undefined : bestCpuFollowUp(predicted, platformIndex, platforms, landingAt);
    const landingRange = cpuLandingRange(predicted);
    const followUpCenter = followUp?.targetCenterX ?? predicted.x + predicted.w / 2;
    const desiredLandingCenterX = clamp(followUpCenter, landingRange.min, landingRange.max);
    const platformAtAscent = currentPlatform(platform, now + jump.ascentMs);
    const canPassThrough = platformIndex === CPU_GOAL_INDEX || platformAtAscent.active === false;
    const airControlDistance = stage.moveSpeed * ((jump.flightMs - jump.ascentMs) / 1000) * 0.86;
    const approach = cpuPlatformApproach(sourceRange, platformAtAscent, landingRange, desiredLandingCenterX, airControlDistance, canPassThrough);
    if (!approach) return [];
    const { takeoffCenterX, landingCenterX } = approach;
    const approachDistance = Math.abs(playerCenterX - takeoffCenterX);
    const hazardPenalty = predicted.kind === "vanish" ? 45 : predicted.kind === "moving" ? 20 : 0;
    const deadEndPenalty = followUp || predicted.y <= stage.goalY + 520 ? 0 : 900;
    const score = approachDistance * 0.72 - jump.rise * 0.72 + (followUp?.score ?? 0) * 0.58 + hazardPenalty + deadEndPenalty;
    return [{
      platformIndex,
      takeoffCenterX,
      landingCenterX,
      landingRatio: (landingCenterX - predicted.x) / predicted.w,
      minLandingCenterX: landingRange.min,
      maxLandingCenterX: landingRange.max,
      jumpHeldMs: jump.jumpHeldMs,
      score
    }];
  });
  return plans.sort((a, b) => a.score - b.score)[0];
}

function bestCpuFollowUp(source: Platform, sourceIndex: number, platforms: Platform[], now: number) {
  const routeTargets = [
    ...platforms.map((platform, platformIndex) => ({ platform, platformIndex })),
    { platform: CPU_GOAL_PLATFORM, platformIndex: CPU_GOAL_INDEX }
  ];
  const options = routeTargets.flatMap(({ platform, platformIndex }) => {
    if (platformIndex === sourceIndex) return [];
    const jump = cpuJumpPlan(source.y - platform.y);
    if (!jump) return [];
    const landingAt = now + jump.flightMs;
    const predicted = currentPlatform(platform, landingAt);
    if (!cpuPlatformSafeAt(platform, landingAt)) return [];
    const gap = horizontalPlatformGap(source, predicted);
    const travel = stage.moveSpeed * (jump.flightMs / 1000) * 0.8;
    if (gap > travel) return [];
    const hazardPenalty = predicted.kind === "vanish" ? 35 : predicted.kind === "moving" ? 15 : 0;
    return [{ targetCenterX: predicted.x + predicted.w / 2, score: gap - jump.rise * 0.42 + hazardPenalty }];
  });
  return options.sort((a, b) => a.score - b.score)[0];
}

function cpuTargetPlatform(room: RoomRuntime, platformIndex: number) {
  return platformIndex === CPU_GOAL_INDEX ? CPU_GOAL_PLATFORM : stagePlatforms(room.mode, room.stageId)[platformIndex];
}

function cpuJumpPlan(rise: number) {
  if (rise < 50 || rise > 470) return undefined;
  const jumpHeldMs = clamp(315 + rise * 0.67, 330, 650);
  const timing = cpuJumpTiming(rise, jumpHeldMs);
  return timing ? { rise, jumpHeldMs, ...timing } : undefined;
}

function cpuFlightMs(rise: number, jumpHeldMs: number) {
  return cpuJumpTiming(rise, jumpHeldMs)?.flightMs ?? 0;
}

function cpuJumpTiming(rise: number, jumpHeldMs: number) {
  if (rise <= 0) return undefined;
  const jumpPower = Math.min(stage.jumpMax, stage.jumpMin + Math.min(jumpHeldMs, 650) * 0.8);
  const discriminant = jumpPower * jumpPower - 2 * stage.gravity * rise;
  if (discriminant <= 0) return undefined;
  const root = Math.sqrt(discriminant);
  return {
    ascentMs: ((jumpPower - root) / stage.gravity) * 1000,
    flightMs: ((jumpPower + root) / stage.gravity) * 1000
  };
}

function cpuRemainingFlightMs(player: PlayerRuntime, targetY: number) {
  const displacement = targetY - stage.playerH - player.y;
  const discriminant = player.vy * player.vy + 2 * stage.gravity * displacement;
  if (discriminant <= 0) return 0;
  const seconds = (-player.vy + Math.sqrt(discriminant)) / stage.gravity;
  return seconds > 0 ? seconds * 1000 : 0;
}

function cpuPlatformSafeAt(platform: Platform, landingAt: number) {
  return currentPlatform(platform, landingAt).active !== false && currentPlatform(platform, landingAt + CPU_LANDING_GRACE_MS).active !== false;
}

function cpuLandingRange(platform: Platform) {
  const margin = stage.playerW / 2 + 10;
  const center = platform.x + platform.w / 2;
  return {
    min: Math.min(center, platform.x + margin),
    max: Math.max(center, platform.x + platform.w - margin)
  };
}

function cpuPlatformApproach(
  sourceRange: { min: number; max: number },
  targetAtAscent: Platform,
  landingRange: { min: number; max: number },
  desiredLandingCenterX: number,
  airControlDistance: number,
  canPassThrough: boolean
) {
  if (canPassThrough) {
    const takeoffCenterX = clamp(desiredLandingCenterX, sourceRange.min, sourceRange.max);
    const minLanding = Math.max(landingRange.min, takeoffCenterX - airControlDistance);
    const maxLanding = Math.min(landingRange.max, takeoffCenterX + airControlDistance);
    if (minLanding > maxLanding) return undefined;
    return { takeoffCenterX, landingCenterX: clamp(desiredLandingCenterX, minLanding, maxLanding) };
  }

  const clearance = stage.playerW / 2 + 10;
  const left = clamp(targetAtAscent.x - clearance, sourceRange.min, sourceRange.max);
  const right = clamp(targetAtAscent.x + targetAtAscent.w + clearance, sourceRange.min, sourceRange.max);
  const candidates = [left, right]
    .filter((candidate, index) => index === 0
      ? candidate <= targetAtAscent.x - stage.playerW / 2 - 4
      : candidate >= targetAtAscent.x + targetAtAscent.w + stage.playerW / 2 + 4)
    .flatMap((takeoffCenterX) => {
      const minLanding = Math.max(landingRange.min, takeoffCenterX - airControlDistance);
      const maxLanding = Math.min(landingRange.max, takeoffCenterX + airControlDistance);
      if (minLanding > maxLanding) return [];
      const landingCenterX = clamp(desiredLandingCenterX, minLanding, maxLanding);
      return [{ takeoffCenterX, landingCenterX, score: Math.abs(landingCenterX - desiredLandingCenterX) }];
    });
  const best = candidates.sort((a, b) => a.score - b.score)[0];
  return best ? { takeoffCenterX: best.takeoffCenterX, landingCenterX: best.landingCenterX } : undefined;
}

function horizontalPlatformGap(from: Platform, to: Platform) {
  if (from.x + from.w < to.x) return to.x - (from.x + from.w);
  if (to.x + to.w < from.x) return from.x - (to.x + to.w);
  return 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function indexedCollisionPlatforms(room: Pick<RoomRuntime, "mode" | "stageId">, now: number) {
  return stagePlatforms(room.mode, room.stageId)
    .map((platform, index) => ({ index, platform: currentPlatform(platform, now) }))
    .filter(({ platform }) => platform.active !== false);
}

function activePlatforms(room: Pick<RoomRuntime, "mode" | "stageId">) {
  return indexedCollisionPlatforms(room, Date.now()).map(({ platform }) => platform);
}

function spawnXFor(index: number) {
  const columns = 10;
  const col = index % columns;
  const row = Math.floor(index / columns);
  return stage.spawnX - 450 + col * 100 + (row % 2) * 50;
}

function emitEffect(io: SkyRushServer, room: RoomRuntime, payload: EffectBurst) {
  io.to(room.id).emit("effectBurst", payload);
}

function resolvePlayerPushes(io: SkyRushServer, room: RoomRuntime) {
  const players = [...room.players.values()].filter((player) => player.connected && !player.finishedAt);
  const now = Date.now();
  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        const a = players[i];
        const b = players[j];
        const overlapX = Math.min(a.x + stage.playerW, b.x + stage.playerW) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + stage.playerH, b.y + stage.playerH) - Math.max(a.y, b.y);
        if (overlapX <= 0 || overlapY <= 0) continue;

        if (overlapY < 14 && Math.abs(a.vy - b.vy) > 60) continue;
        const direction = a.x + stage.playerW / 2 < b.x + stage.playerW / 2 ? -1 : 1;
        const push = Math.min(18, overlapX / 2 + 1);
        a.x += direction * push;
        b.x -= direction * push;
        a.vx += direction * 42;
        b.vx -= direction * 42;
        if (push > 5 && now - a.lastPushEffectAt > 280 && now - b.lastPushEffectAt > 280) {
          a.lastPushEffectAt = now;
          b.lastPushEffectAt = now;
          emitEffect(io, room, { kind: "push", x: (a.x + b.x) / 2 + stage.playerW / 2, y: Math.min(a.y, b.y) + stage.playerH / 2 });
        }

        for (const player of [a, b]) {
          const bounds = courseBoundsAt(player.y, stageMetrics(room.stageId));
          player.x = Math.max(bounds.left, Math.min(bounds.right - stage.playerW, player.x));
        }
      }
    }
  }
}
