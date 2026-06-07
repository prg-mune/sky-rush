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
  ServerToClientEvents
} from "../shared/types";

type SocketData = {
  playerName?: string;
  roomId?: string;
};

type PlayerRuntime = PlayerSnapshot & {
  socketId: string;
  input: ClientInput;
  lastJumpRequestId: number;
  onGround: boolean;
  wallTouch: "left" | "right" | null;
  aiTargetX?: number;
  aiNextThinkAt?: number;
  aiNextJumpAt?: number;
  aiSkill: number;
  lastPushEffectAt: number;
};

type RoomRuntime = Omit<RoomState, "players"> & {
  players: Map<string, PlayerRuntime>;
};

type SkyRushServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type SkyRushSocket = IOSocket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type Platform = { x: number; y: number; w: number; h: number; kind?: "jumpPad" | "teamJumpPad" };

const PASSWORD = "progress4649";
const PORT = Number(process.env.PORT || 3000);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
const rooms = new Map<string, RoomRuntime>();

const stage = {
  width: 2200,
  height: 4200,
  goalY: 160,
  spawnX: 1100,
  spawnY: 3950,
  gravity: 2100,
  moveSpeed: 360,
  jumpMin: 900,
  jumpMax: 1360,
  playerW: 34,
  playerH: 46
};

const platforms: Platform[] = [
  { x: 520, y: 4060, w: 1160, h: 28 },
  { x: 260, y: 3780, w: 420, h: 24 },
  { x: 980, y: 3780, w: 420, h: 24, kind: "jumpPad" },
  { x: 1530, y: 3780, w: 360, h: 24 },
  { x: 710, y: 3500, w: 380, h: 24 },
  { x: 1320, y: 3500, w: 380, h: 24 },
  { x: 400, y: 3220, w: 350, h: 24, kind: "jumpPad" },
  { x: 1040, y: 3220, w: 360, h: 24 },
  { x: 1490, y: 2940, w: 330, h: 24 },
  { x: 700, y: 2940, w: 330, h: 24 },
  { x: 450, y: 2660, w: 320, h: 24 },
  { x: 1060, y: 2660, w: 330, h: 24, kind: "jumpPad" },
  { x: 1380, y: 2380, w: 300, h: 24 },
  { x: 760, y: 2380, w: 310, h: 24 },
  { x: 520, y: 2100, w: 290, h: 24, kind: "jumpPad" },
  { x: 1130, y: 2100, w: 300, h: 24 },
  { x: 860, y: 1820, w: 290, h: 24 },
  { x: 1220, y: 1540, w: 270, h: 24 },
  { x: 750, y: 1540, w: 270, h: 24 },
  { x: 1000, y: 1260, w: 260, h: 24, kind: "jumpPad" },
  { x: 780, y: 980, w: 240, h: 24 },
  { x: 1160, y: 980, w: 240, h: 24 },
  { x: 940, y: 700, w: 240, h: 24, kind: "jumpPad" },
  { x: 980, y: 420, w: 260, h: 24 }
];

const teamChallengePlatforms: Platform[] = [
  { x: 875, y: 1720, w: 450, h: 28, kind: "teamJumpPad" },
  { x: 990, y: 1120, w: 300, h: 28 },
  { x: 1015, y: 840, w: 250, h: 24 }
];

const CPU_TARGET_PLAYERS = 20;
const COUNTDOWN_MS = 4000;

function roomSnapshot(room: RoomRuntime): RoomState {
  return {
    ...room,
    players: [...room.players.values()].map(({ input, onGround, wallTouch, socketId, aiTargetX, aiNextThinkAt, aiNextJumpAt, aiSkill, lastPushEffectAt, ...player }) => player)
  };
}

function roomSummary(room: RoomRuntime): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    mode: room.mode,
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

function makePlayer(socketId: string, name: string, index: number, mode: GameMode, isCpu = false): PlayerRuntime {
  return {
    id: socketId,
    socketId,
    name,
    x: spawnXFor(index),
    y: stage.spawnY,
    vx: 0,
    vy: 0,
    facing: "right",
    jumping: false,
    altitude: 0,
    connected: true,
    isCpu,
    team: mode === "team" ? (index % 4) + 1 : undefined,
    input: { left: false, right: false, jump: false, jumpHeldMs: 0, jumpRequestId: 0, seq: 0 },
    lastJumpRequestId: 0,
    onGround: false,
    wallTouch: null,
    aiSkill: isCpu ? 0.72 + Math.random() * 0.26 : 1,
    lastPushEffectAt: 0
  };
}

function broadcastRooms(io: SkyRushServer) {
  io.emit("rooms", [...rooms.values()].map(roomSummary));
}

function finishRoom(io: SkyRushServer, room: RoomRuntime, winner: PlayerRuntime) {
  if (room.finishedAt) return;
  room.winnerId = winner.id;
  room.winningTeam = winner.team;
  room.finishedAt = Date.now();
  io.to(room.id).emit("gameEnded", { room: roomSnapshot(room), results: results(room) });
  broadcastRooms(io);
}

function stepPhysics(io: SkyRushServer, dt: number) {
  for (const room of rooms.values()) {
    if (!room.started || room.finishedAt) continue;
    if (room.startedAt && Date.now() < room.startedAt) {
      io.to(room.id).emit("gameState", roomSnapshot(room));
      continue;
    }
    for (const player of room.players.values()) {
      if (player.isCpu) updateCpuInput(player, room);

      const input = player.input;
      const move = Number(input.right) - Number(input.left);
      player.vx = move * stage.moveSpeed;
      if (move < 0) player.facing = "left";
      if (move > 0) player.facing = "right";

      const requestedJump = input.jumpRequestId !== player.lastJumpRequestId;
      if (requestedJump && (player.onGround || player.wallTouch)) {
        player.lastJumpRequestId = input.jumpRequestId;
        const jumpPower = Math.min(stage.jumpMax, stage.jumpMin + Math.min(input.jumpHeldMs, 650) * 0.8);
        player.vy = -jumpPower;
        player.jumping = true;
        if (player.wallTouch === "left") player.vx = stage.moveSpeed * 1.25;
        if (player.wallTouch === "right") player.vx = -stage.moveSpeed * 1.25;
      } else if (requestedJump) {
        player.lastJumpRequestId = input.jumpRequestId;
      }

      const previousY = player.y;
      player.vy += stage.gravity * dt;
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      player.wallTouch = null;
      player.onGround = false;

      const bounds = courseBoundsAt(player.y);
      if (player.x < bounds.left) {
        player.x = bounds.left;
        player.wallTouch = "left";
      }
      if (player.x > bounds.right - stage.playerW) {
        player.x = bounds.right - stage.playerW;
        player.wallTouch = "right";
      }

      for (const platform of activePlatforms(room.mode)) {
        const withinX = player.x + stage.playerW > platform.x && player.x < platform.x + platform.w;
        const previousBottom = previousY + stage.playerH;
        const currentBottom = player.y + stage.playerH;
        const platformBottom = platform.y + platform.h;
        const landedOnTop = player.vy >= 0 && withinX && previousBottom <= platform.y && currentBottom >= platform.y;
        const hitUnderside = player.vy < 0 && withinX && previousY >= platformBottom && player.y <= platformBottom;
        if (landedOnTop) {
          player.y = platform.y - stage.playerH;
          if (platform.kind === "jumpPad" || platform.kind === "teamJumpPad") {
            const teamPowered = platform.kind === "teamJumpPad" && hasNearbyTeammate(room, player, platform);
            if (platform.kind === "teamJumpPad" && !teamPowered) {
              player.vy = -stage.jumpMax * 0.84;
            } else {
              player.vy = -stage.jumpMax * (teamPowered ? 1.48 : 1.22);
            }
            player.onGround = false;
            player.jumping = true;
            emitEffect(io, room, { kind: "jumpPad", x: player.x + stage.playerW / 2, y: platform.y });
          } else {
            player.vy = 0;
            player.onGround = true;
            player.jumping = false;
          }
        } else if (hitUnderside) {
          player.y = platformBottom;
          player.vy = 140;
        }
      }

      for (const other of room.players.values()) {
        if (other.id === player.id) continue;
        const landingOnPlayer =
          player.vy > 0 &&
          player.x + stage.playerW > other.x &&
          player.x < other.x + stage.playerW &&
          player.y + stage.playerH >= other.y &&
          player.y + stage.playerH <= other.y + 16;
        if (landingOnPlayer) {
          player.y = other.y - stage.playerH;
          const sameTeam = room.mode === "team" && player.team && player.team === other.team;
          player.vy = -stage.jumpMax * (sameTeam ? 1.38 : 1.02);
          player.onGround = false;
          if (sameTeam) emitEffect(io, room, { kind: "jumpPad", x: player.x + stage.playerW / 2, y: player.y + stage.playerH });
        }
      }

      if (player.y > stage.spawnY + 460) {
        player.x = spawnXFor(Number(player.id.replace(/\D/g, "").slice(-2)) || 0);
        player.y = stage.spawnY;
        player.vx = 0;
        player.vy = 0;
      }

      player.altitude = Math.max(0, stage.spawnY - player.y);
      if (player.y <= stage.goalY && !player.finishedAt) {
        player.finishedAt = Date.now();
        finishRoom(io, room, player);
      }
    }
    resolvePlayerPushes(io, room);
    io.to(room.id).emit("gameState", roomSnapshot(room));
  }
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io: SkyRushServer = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: { origin: "*" }
  });

  io.on("connection", (socket) => {
    socket.on("login", ({ playerName, password }, cb) => {
      if (password !== PASSWORD) return cb(false, "パスワードが違います");
      const trimmed = playerName.trim().slice(0, 16);
      if (!trimmed) return cb(false, "プレイヤー名を入力してください");
      socket.data.playerName = trimmed;
      cb(true);
      socket.emit("rooms", [...rooms.values()].map(roomSummary));
    });

    socket.on("listRooms", () => socket.emit("rooms", [...rooms.values()].map(roomSummary)));

    socket.on("createRoom", ({ name, mode, maxPlayers }) => {
      if (!socket.data.playerName) return socket.emit("errorMessage", "ログインしてください");
      const id = `room-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const room: RoomRuntime = {
        id,
        name: name.trim().slice(0, 24) || `${socket.data.playerName}の部屋`,
        mode,
        maxPlayers: Math.max(2, Math.min(50, maxPlayers)),
        ownerId: socket.id,
        started: false,
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

    socket.on("startGame", () => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      if (!room || room.ownerId !== socket.id) return;
      addCpuPlayers(room, Math.min(room.maxPlayers, CPU_TARGET_PLAYERS) - room.players.size);
      room.started = true;
      room.startedAt = Date.now() + COUNTDOWN_MS;
      io.to(room.id).emit("gameStarted", roomSnapshot(room));
      broadcastRooms(io);
    });

    socket.on("input", (input) => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const player = room?.players.get(socket.id);
      if (player && input.seq >= player.input.seq) player.input = input;
    });

    socket.on("disconnect", () => leaveRoom(io, socket, true));
  });

  setInterval(() => stepPhysics(io, 1 / 30), 1000 / 30);
  httpServer.listen(PORT, () => console.log(`Sky Rush listening on http://localhost:${PORT}`));
});

function joinRoom(
  io: SkyRushServer,
  socket: SkyRushSocket,
  room: RoomRuntime
) {
  leaveRoom(io, socket);
  socket.join(room.id);
  socket.data.roomId = room.id;
  room.players.set(socket.id, makePlayer(socket.id, socket.data.playerName || "Player", room.players.size, room.mode));
  io.to(room.id).emit("roomState", roomSnapshot(room));
}

function leaveRoom(io: SkyRushServer, socket: Pick<SkyRushSocket, "id" | "data" | "leave">, disconnected = false) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;
  if (disconnected && room.started && !room.finishedAt) {
    const player = room.players.get(socket.id);
    if (player) player.connected = false;
  } else {
    room.players.delete(socket.id);
    socket.leave(roomId);
  }
  socket.data.roomId = undefined;
  const humanPlayers = [...room.players.values()].filter((player) => !player.isCpu);
  if (humanPlayers.length === 0) rooms.delete(roomId);
  else {
    if (room.ownerId === socket.id) room.ownerId = humanPlayers[0].id;
    io.to(room.id).emit("roomState", roomSnapshot(room));
  }
  broadcastRooms(io);
}

function addCpuPlayers(room: RoomRuntime, count: number) {
  const roomForId = room.id.replace(/[^a-zA-Z0-9]/g, "");
  for (let i = 0; i < count && room.players.size < room.maxPlayers; i += 1) {
    const cpuNumber = [...room.players.values()].filter((player) => player.isCpu).length + 1;
    const id = `cpu-${roomForId}-${cpuNumber}`;
    room.players.set(id, makePlayer(id, `CPU ${cpuNumber}`, room.players.size, room.mode, true));
  }
}

function updateCpuInput(player: PlayerRuntime, room: RoomRuntime) {
  const now = Date.now();
  const coursePlatforms = activePlatforms(room.mode);
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

function activePlatforms(mode: GameMode) {
  if (mode !== "team") return platforms;
  return [
    ...platforms.filter((platform) => platform.y !== 1820 && platform.y !== 1540 && platform.y !== 1260),
    ...teamChallengePlatforms
  ].sort((a, b) => b.y - a.y);
}

function hasNearbyTeammate(room: RoomRuntime, player: PlayerRuntime, platform: Platform) {
  if (room.mode !== "team" || !player.team) return false;
  return [...room.players.values()].some((other) => {
    if (other.id === player.id || other.team !== player.team || !other.connected) return false;
    const onPadWidth = other.x + stage.playerW > platform.x - 60 && other.x < platform.x + platform.w + 60;
    const nearPadHeight = Math.abs(other.y + stage.playerH - platform.y) < 120;
    return onPadWidth && nearPadHeight;
  });
}

function spawnXFor(index: number) {
  const columns = 10;
  const col = index % columns;
  const row = Math.floor(index / columns);
  return stage.spawnX - 450 + col * 100 + (row % 2) * 50;
}

function courseBoundsAt(y: number) {
  const climbRatio = Math.max(0, Math.min(1, (stage.spawnY - y) / (stage.spawnY - stage.goalY)));
  const width = 2050 - climbRatio * 1120;
  const center = stage.width / 2;
  return {
    left: center - width / 2,
    right: center + width / 2
  };
}

function emitEffect(io: SkyRushServer, room: RoomRuntime, payload: EffectBurst) {
  io.to(room.id).emit("effectBurst", payload);
}

function resolvePlayerPushes(io: SkyRushServer, room: RoomRuntime) {
  const players = [...room.players.values()].filter((player) => player.connected);
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
          const bounds = courseBoundsAt(player.y);
          player.x = Math.max(bounds.left, Math.min(bounds.right - stage.playerW, player.x));
        }
      }
    }
  }
}
