import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ResultRow, RoomState, ServerToClientEvents } from "../shared/types";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const url = process.env.SKY_RUSH_URL || "http://127.0.0.1:3000";
const password = process.env.SKY_RUSH_PASSWORD || "progress4649";

function waitFor<T>(socket: TypedSocket, event: keyof ServerToClientEvents, predicate: (payload: T) => boolean, timeoutMs = 5000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event as never, listener as never);
      reject(new Error(`Timed out waiting for ${String(event)}`));
    }, timeoutMs);
    const listener = (payload: T) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event as never, listener as never);
      resolve(payload);
    };
    socket.on(event as never, listener as never);
  });
}

function connect(socket: TypedSocket) {
  if (socket.connected) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
}

function login(socket: TypedSocket, playerName: string) {
  return new Promise<void>((resolve, reject) => {
    socket.emit("login", { playerName, password }, (ok, message) => ok ? resolve() : reject(new Error(message || "Login failed")));
  });
}

function setSpectator(socket: TypedSocket, spectator: boolean) {
  return new Promise<void>((resolve, reject) => {
    socket.emit("setSpectator", spectator, (ok, message) => ok ? resolve() : reject(new Error(message || "Role change failed")));
  });
}

function joinRoomWithPasscode(socket: TypedSocket, roomId: string, passcode?: string) {
  return new Promise<void>((resolve, reject) => {
    socket.emit("joinRoom", { roomId, passcode }, (ok, message) => ok ? resolve() : reject(new Error(message || "Join failed")));
  });
}

async function run() {
  const host = io(url, { transports: ["websocket"], reconnection: false }) as TypedSocket;
  const guest = io(url, { transports: ["websocket"], reconnection: false }) as TypedSocket;
  try {
    await Promise.all([connect(host), connect(guest)]);
    await Promise.all([login(host, "HostControlTest"), login(guest, "GuestControlTest")]);

    const created = waitFor<RoomState>(host, "roomState", (room) => room.ownerId === host.id && room.players.length === 1);
    host.emit("createRoom", {
      name: "Host control test",
      mode: "battle",
      difficulty: "normal",
      maxPlayers: 5,
      stageId: "battle_01_garden",
      passcode: "4649"
    });
    const room = await created;

    let wrongPasscodeRejected = false;
    try {
      await joinRoomWithPasscode(guest, room.id, "0000");
    } catch {
      wrongPasscodeRejected = true;
    }
    if (!wrongPasscodeRejected) throw new Error("Protected room accepted the wrong passcode");

    const joined = waitFor<RoomState>(host, "roomState", (next) => next.id === room.id && next.players.length === 2);
    await Promise.all([joinRoomWithPasscode(guest, room.id, "4649"), joined]);

    const guestRemoved = waitFor<string>(guest, "removedFromRoom", (reason) => reason.length > 0);
    const hostSawRemoval = waitFor<RoomState>(host, "roomState", (next) => next.id === room.id && next.players.length === 1);
    host.emit("removePlayer", guest.id || "");
    await Promise.all([guestRemoved, hostSawRemoval]);

    const rejoined = waitFor<RoomState>(host, "roomState", (next) => next.id === room.id && next.players.length === 2);
    await Promise.all([joinRoomWithPasscode(guest, room.id, "4649"), rejoined]);

    const started = waitFor<RoomState>(host, "gameStarted", (next) => next.id === room.id && next.started && next.players.length === 5);
    host.emit("startGame");
    await started;

    const ended = waitFor<{ room: RoomState }>(host, "gameEnded", (payload) => payload.room.id === room.id && payload.room.finishReason === "hostEnded");
    host.emit("endGame");
    await ended;

    const rematch = waitFor<RoomState>(host, "roomState", (next) => next.id === room.id && !next.started && next.players.length === 2 && next.players.every((player) => !player.isCpu));
    host.emit("prepareRematch");
    await rematch;

    const retireRaceStarted = waitFor<RoomState>(host, "gameStarted", (next) => next.id === room.id && next.started);
    host.emit("startGame");
    await retireRaceStarted;
    await new Promise((resolve) => setTimeout(resolve, 5200));

    const guestRetired = waitFor<RoomState>(host, "roomState", (next) => (
      next.id === room.id && Boolean(next.players.find((player) => player.id === guest.id)?.retiredAt)
    ));
    guest.emit("retire");
    await guestRetired;

    const retireRaceEnded = waitFor<{ room: RoomState; results: ResultRow[] }>(host, "gameEnded", (payload) => (
      payload.room.id === room.id && payload.room.finishReason === "allHumansFinished"
    ));
    host.emit("retire");
    const retireResult = await retireRaceEnded;
    const humanResults = retireResult.results.filter((row) => row.playerName === "HostControlTest" || row.playerName === "GuestControlTest");
    if (humanResults.length !== 2 || humanResults.some((row) => !row.retired || row.goalTimeMs !== undefined)) {
      throw new Error("Retired racers were not represented correctly in results");
    }

    const retireRematch = waitFor<RoomState>(host, "roomState", (next) => (
      next.id === room.id && !next.started && next.players.length === 2 && next.players.every((player) => !player.retiredAt)
    ));
    host.emit("prepareRematch");
    await retireRematch;

    const hostBecameSpectator = waitFor<RoomState>(host, "roomState", (next) => (
      next.id === room.id && Boolean(next.players.find((player) => player.id === host.id)?.spectator)
    ));
    await setSpectator(host, true);
    await hostBecameSpectator;

    const spectatorRaceStarted = waitFor<RoomState>(host, "gameStarted", (next) => (
      next.id === room.id &&
      next.players.filter((player) => player.isCpu).length === 4 &&
      Boolean(next.players.find((player) => player.id === host.id)?.spectator)
    ));
    host.emit("startGame");
    await spectatorRaceStarted;

    const spectatorRaceEnded = waitFor<{ room: RoomState; results: Array<{ playerName: string }> }>(host, "gameEnded", (payload) => (
      payload.room.id === room.id && payload.room.finishReason === "hostEnded"
    ));
    host.emit("endGame");
    const spectatorRaceResult = await spectatorRaceEnded;
    if (spectatorRaceResult.results.length !== 5 || spectatorRaceResult.results.some((row) => row.playerName === "HostControlTest")) {
      throw new Error("Spectator race included the host or had the wrong racer count");
    }

    const spectatorRematch = waitFor<RoomState>(host, "roomState", (next) => (
      next.id === room.id && !next.started && next.players.length === 2 && Boolean(next.players.find((player) => player.id === host.id)?.spectator)
    ));
    host.emit("prepareRematch");
    await spectatorRematch;

    const guestLeft = waitFor<RoomState>(host, "roomState", (next) => next.id === room.id && next.players.length === 1);
    guest.emit("leaveRoom");
    await guestLeft;

    const cpuOnlyStarted = waitFor<RoomState>(host, "gameStarted", (next) => (
      next.id === room.id && next.players.filter((player) => player.isCpu).length === 5 && Boolean(next.players.find((player) => player.id === host.id)?.spectator)
    ));
    host.emit("startGame");
    await cpuOnlyStarted;

    const cpuOnlyEnded = waitFor<{ room: RoomState; results: Array<{ playerName: string }> }>(host, "gameEnded", (payload) => (
      payload.room.id === room.id && payload.room.finishReason === "hostEnded"
    ));
    host.emit("endGame");
    const cpuOnlyResult = await cpuOnlyEnded;
    if (cpuOnlyResult.results.length !== 5 || cpuOnlyResult.results.some((row) => row.playerName === "HostControlTest")) {
      throw new Error("CPU-only spectator race included the host or had the wrong CPU count");
    }

    const cpuOnlyRematch = waitFor<RoomState>(host, "roomState", (next) => (
      next.id === room.id && !next.started && next.players.length === 1 && Boolean(next.players[0].spectator)
    ));
    host.emit("prepareRematch");
    await cpuOnlyRematch;

    const hostReturnedToRace = waitFor<RoomState>(host, "roomState", (next) => (
      next.id === room.id && !next.players[0].spectator
    ));
    await setSpectator(host, false);
    await hostReturnedToRace;

    console.log("Host control integration test passed.");
  } finally {
    host.disconnect();
    guest.disconnect();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
