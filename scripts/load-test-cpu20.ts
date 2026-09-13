import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ResultRow,
  RoomState,
  ServerToClientEvents,
  StageId
} from "../shared/types";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const url = process.env.SKY_RUSH_URL || "http://127.0.0.1:3000";
const durationMs = Number(process.env.SKY_RUSH_LOAD_TEST_MS || 120_000);
const stageId = (process.env.SKY_RUSH_STAGE_ID || "battle_10_everest_rush") as StageId;
const password = process.env.SKY_RUSH_PASSWORD || "progress4649";
const playerCount = Math.max(2, Math.min(20, Number(process.env.SKY_RUSH_LOAD_PLAYERS || 20)));
const traceCpu = process.env.SKY_RUSH_TRACE_CPU === "1";

let gameStateCount = 0;
let maxPlayers = 0;
let lastStateAt = 0;
let maxStateGapMs = 0;
let totalStateGapMs = 0;
let finished = false;
let latestRoom: RoomState | null = null;
let results: ResultRow[] = [];
let lastTraceAt = 0;
const errors: string[] = [];

const startedAt = Date.now();
const socket: TypedSocket = io(url, {
  transports: ["websocket"],
  reconnection: false,
  timeout: 10_000
});

const fail = (message: string) => {
  errors.push(message);
  finish(1);
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function finish(exitCode: number) {
  if (finished) return;
  finished = true;
  socket.disconnect();

  const elapsedMs = Date.now() - startedAt;
  const avgGapMs = gameStateCount > 1 ? totalStateGapMs / (gameStateCount - 1) : 0;
  const connectedPlayers = latestRoom?.players.filter((player) => player.connected).length ?? 0;
  const cpuPlayers = latestRoom?.players.filter((player) => player.isCpu).length ?? 0;
  const leader = latestRoom?.players.reduce((best, player) => player.altitude > best.altitude ? player : best, latestRoom.players[0]);

  console.log("Sky Rush CPU20 load test result");
  console.log(`URL: ${url}`);
  console.log(`Stage: ${stageId}`);
  console.log(`Duration: ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`Game states: ${gameStateCount}`);
  console.log(`Average state gap: ${avgGapMs.toFixed(1)}ms`);
  console.log(`Max state gap: ${maxStateGapMs.toFixed(1)}ms`);
  console.log(`Max players observed: ${maxPlayers}`);
  console.log(`Connected players: ${connectedPlayers}`);
  console.log(`CPU players: ${cpuPlayers}`);
  console.log(`Leader altitude: ${Math.round(leader?.altitude ?? 0)}m`);
  const cpuLeaders = (latestRoom?.players ?? [])
    .filter((player) => player.isCpu)
    .sort((a, b) => b.altitude - a.altitude)
    .slice(0, 5)
    .map((player) => `${player.name}:${Math.round(player.altitude)}m@(${Math.round(player.x)},${Math.round(player.y)})`)
    .join(", ");
  console.log(`CPU leaders: ${cpuLeaders || "none"}`);
  console.log(`Finished results: ${results.length}`);
  if (errors.length > 0) {
    console.error("Errors:");
    for (const error of errors) console.error(`- ${error}`);
  }

  process.exit(exitCode);
}

socket.on("connect_error", (error) => fail(`connect_error: ${error.message}`));
socket.on("errorMessage", (message) => errors.push(message));

socket.on("roomState", (room) => {
  latestRoom = room;
  maxPlayers = Math.max(maxPlayers, room.players.length);
});

socket.on("gameStarted", (room) => {
  latestRoom = room;
  maxPlayers = Math.max(maxPlayers, room.players.length);
});

socket.on("gameState", (room) => {
  const now = Date.now();
  if (lastStateAt > 0) {
    const gap = now - lastStateAt;
    totalStateGapMs += gap;
    maxStateGapMs = Math.max(maxStateGapMs, gap);
  }
  lastStateAt = now;
  gameStateCount += 1;
  latestRoom = room;
  maxPlayers = Math.max(maxPlayers, room.players.length);
  if (traceCpu && now - lastTraceAt >= 1000) {
    lastTraceAt = now;
    const cpu = room.players.find((player) => player.isCpu);
    if (cpu) console.log(`CPU trace: ${Math.round(cpu.altitude)}m x=${Math.round(cpu.x)} y=${Math.round(cpu.y)} vx=${Math.round(cpu.vx)} vy=${Math.round(cpu.vy)}`);
  }
});

socket.on("gameEnded", (payload) => {
  latestRoom = payload.room;
  results = payload.results;
});

socket.on("connect", async () => {
  socket.emit("login", { playerName: "LoadTester", password }, async (ok, message) => {
    if (!ok) return fail(message || "login failed");

    socket.emit("createRoom", {
      name: `CPU20 Load ${Date.now().toString(36)}`,
      mode: "battle",
      difficulty: "normal",
      maxPlayers: playerCount,
      stageId
    });

    const deadline = Date.now() + 10_000;
    while (!latestRoom && Date.now() < deadline) await wait(100);
    if (!latestRoom) return fail("room was not created");

    socket.emit("startGame");
    await wait(durationMs);

    if (maxPlayers !== playerCount) errors.push(`expected ${playerCount} players, observed ${maxPlayers}`);
    if (gameStateCount < Math.floor(durationMs / 1000) * 15) {
      errors.push(`too few gameState events: ${gameStateCount}`);
    }
    if (maxStateGapMs > 2000) errors.push(`gameState gap exceeded 2000ms: ${maxStateGapMs.toFixed(1)}ms`);

    finish(errors.length > 0 ? 1 : 0);
  });
});

setTimeout(() => fail("load test timed out"), durationMs + 30_000);
