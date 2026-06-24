import { createServer } from "http";
import next from "next";
import { Server, type Socket as IOSocket } from "socket.io";
import type {
  ClientInput,
  ClientToServerEvents,
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
  activeCollisionPlatforms,
  courseBoundsAt,
  normalizeStageId,
  stage,
  stageMetrics,
  validateStageLayouts
} from "../shared/stage-layout";

type SocketData = {
  playerName?: string;
  roomId?: string;
  sessionId?: string;
};

type PlayerRuntime = PlayerSnapshot & {
  socketId: string;
  sessionId?: string;
  input: ClientInput;
  lastJumpRequestId: number;
  onGround: boolean;
  standingOnPlayerId: string | null;
  wallTouch: "left" | "right" | null;
  aiTargetX?: number;
  aiNextThinkAt?: number;
  aiNextJumpAt?: number;
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
const COUNTDOWN_MS = 4000;
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
    players: [...room.players.values()].map(({ input, onGround, standingOnPlayerId, wallTouch, socketId, sessionId, aiTargetX, aiNextThinkAt, aiNextJumpAt, aiSkill, lastPushEffectAt, lastInputAt, disconnectedAt, ...player }) => player)
  };
}

function roomSummary(room: RoomRuntime): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    mode: room.mode,
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

function makePlayer(socketId: string, name: string, index: number, mode: GameMode, spawnY: number, isCpu = false, preferredTeam?: number, sessionId?: string): PlayerRuntime {
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
    onGround: false,
    standingOnPlayerId: null,
    wallTouch: null,
    aiSkill: isCpu ? 0.72 + Math.random() * 0.26 : 1,
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
    if (room.startedAt && Date.now() < room.startedAt) {
      io.to(room.id).emit("gameState", roomSnapshot(room));
      continue;
    }
    for (const player of room.players.values()) {
      if (!player.connected) continue;
      if (player.finishedAt) {
        player.vx = 0;
        player.vy = 0;
        player.jumping = false;
        continue;
      }
      if (player.isCpu) updateCpuInput(player, room);

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

      const bounds = courseBoundsAt(player.y, metrics);
      if (player.x < bounds.left) {
        player.x = bounds.left;
        player.wallTouch = "left";
      }
      if (player.x > bounds.right - stage.playerW) {
        player.x = bounds.right - stage.playerW;
        player.wallTouch = "right";
      }

      for (const platform of activePlatforms(room)) {
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

      if (player.y > metrics.spawnY + 460) {
        player.x = spawnXFor(Number(player.id.replace(/\D/g, "").slice(-2)) || 0);
        player.y = metrics.spawnY;
        player.vx = 0;
        player.vy = 0;
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

    socket.on("createRoom", ({ name, mode, maxPlayers, stageId }) => {
      if (!socket.data.playerName) return socket.emit("errorMessage", "ログインしてください");
      const id = `room-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const normalizedStageId = normalizeStageId(mode, stageId);
      const room: RoomRuntime = {
        id,
        name: name.trim().slice(0, 24) || `${socket.data.playerName}の部屋`,
        mode,
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
        player.input = input;
        player.lastInputAt = Date.now();
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
    room.players.set(id, makePlayer(id, `CPU ${cpuNumber}`, room.players.size, room.mode, stageMetrics(room.stageId).spawnY, true));
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

function updateCpuInput(player: PlayerRuntime, room: RoomRuntime) {
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
  const targetCenter = target.x + target.w / 2;

  if (!player.aiNextThinkAt || now >= player.aiNextThinkAt) {
    const error = (1 - player.aiSkill) * 180;
    player.aiTargetX = targetCenter + (Math.random() * error * 2 - error);
    player.aiNextThinkAt = now + 180 + Math.random() * 320;
  }

  const desiredX = player.aiTargetX ?? targetCenter;
  const deltaX = desiredX - (player.x + stage.playerW / 2);
  player.input.left = deltaX < -18;
  player.input.right = deltaX > 18;
  player.input.jump = false;

  const closeEnough = Math.abs(deltaX) < 150 + player.aiSkill * 60;
  const stuckAtWall = Boolean(player.wallTouch);
  const canJump = !player.aiNextJumpAt || now >= player.aiNextJumpAt;
  if (canJump && ((player.onGround && closeEnough) || stuckAtWall)) {
    const verticalGap = Math.max(220, player.y - target.y);
    const teamAssist = room.mode === "team" && player.team && [...room.players.values()].some((other) => other.id !== player.id && other.team === player.team && Math.abs(other.x - player.x) < 180 && Math.abs(other.y - player.y) < 180);
    player.input.jumpHeldMs = Math.min(650, 330 + verticalGap * 0.62 + Math.random() * 90 + (teamAssist ? 90 : 0));
    player.input.jumpRequestId += 1;
    player.aiNextJumpAt = now + 560 + Math.random() * 260;
  }

  player.input.seq += 1;
}

function activePlatforms(room: Pick<RoomRuntime, "mode" | "stageId">) {
  return activeCollisionPlatforms(room.mode, room.stageId, Date.now());
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
