import dynamic from "next/dynamic";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  GameMode,
  ResultRow,
  RoomState,
  RoomSummary,
  ServerToClientEvents,
  StagePreset
} from "../shared/types";

const SkyRushGame = dynamic(() => import("../src/SkyRushGame"), { ssr: false });

type Screen = "login" | "lobby" | "waiting" | "game" | "result";
type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export default function Home() {
  const [socket, setSocket] = useState<TypedSocket | null>(null);
  const [screen, setScreen] = useState<Screen>("login");
  const [playerName, setPlayerName] = useState("");
  const [password, setPassword] = useState("");
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [message, setMessage] = useState("");
  const [roomName, setRoomName] = useState("");
  const [mode, setMode] = useState<GameMode>("battle");
  const [preset, setPreset] = useState<StagePreset>("balanced");
  const [maxPlayers, setMaxPlayers] = useState(20);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const nextSocket: TypedSocket = io({ transports: ["websocket"] });
    setSocket(nextSocket);
    nextSocket.on("rooms", setRooms);
    nextSocket.on("roomState", (nextRoom) => {
      setRoom(nextRoom);
      setScreen(nextRoom.started ? "game" : "waiting");
    });
    nextSocket.on("gameStarted", (nextRoom) => {
      setRoom(nextRoom);
      setScreen("game");
    });
    nextSocket.on("gameState", setRoom);
    nextSocket.on("gameEnded", ({ room: endedRoom, results: endedResults }) => {
      setRoom(endedRoom);
      setResults(endedResults);
      setScreen("result");
    });
    nextSocket.on("errorMessage", setMessage);
    return () => {
      nextSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  const me = useMemo(() => room?.players.find((player) => player.id === socket?.id), [room, socket?.id]);
  const isOwner = Boolean(room && socket?.id === room.ownerId);
  const countdownMs = Math.max(0, (room?.startedAt || 0) - now);
  const countdownLabel = countdownMs > 0 ? Math.ceil(countdownMs / 1000).toString() : "";
  const isLastSpurt = Boolean(me && me.altitude > 3200 && !room?.finishedAt);

  function login() {
    setMessage("");
    socket?.emit("login", { playerName, password }, (ok, nextMessage) => {
      if (ok) {
        setScreen("lobby");
        socket.emit("listRooms");
      } else {
        setMessage(nextMessage || "ログインできませんでした");
      }
    });
  }

  function createRoom() {
    socket?.emit("createRoom", { name: roomName, mode, maxPlayers, preset });
  }

  function leaveToLobby() {
    socket?.emit("leaveRoom");
    socket?.emit("listRooms");
    setRoom(null);
    setResults([]);
    setScreen("lobby");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Sky Rush v0.1</p>
          <h1>スカイラッシュ</h1>
        </div>
        {screen !== "login" && <button onClick={leaveToLobby}>ロビー</button>}
      </header>

      {message && <div className="toast">{message}</div>}

      {screen === "login" && (
        <section className="panel auth">
          <h2>ログイン</h2>
          <label>
            プレイヤー名
            <input
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="Player01"
              maxLength={16}
              autoComplete="off"
              name="sky-rush-player-name"
            />
          </label>
          <label>
            パスワード
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              placeholder="progress4649"
              autoComplete="new-password"
              name="sky-rush-room-password"
            />
          </label>
          <button className="primary" onClick={login}>入る</button>
        </section>
      )}

      {screen === "lobby" && (
        <section className="grid two">
          <div className="panel">
            <h2>部屋を作成</h2>
            <label>
              部屋名
              <input value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder={`${playerName || "Player"}の部屋`} />
            </label>
            <label>
              ゲームモード
              <select value={mode} onChange={(event) => setMode(event.target.value as GameMode)}>
                <option value="battle">バトルロワイヤル登山</option>
                <option value="team">チーム登山</option>
              </select>
            </label>
            <label>
              ステージ
              <select value={preset} onChange={(event) => setPreset(event.target.value as StagePreset)}>
                <option value="balanced">バランス型</option>
                <option value="boost">消える床多め</option>
                <option value="stretch">伸縮バー多め</option>
                <option value="teamwork">チーム協力多め</option>
              </select>
            </label>
            <label>
              最大人数 {maxPlayers}
              <input type="range" min={2} max={50} value={maxPlayers} onChange={(event) => setMaxPlayers(Number(event.target.value))} />
            </label>
            <button className="primary" onClick={createRoom}>作成</button>
          </div>
          <div className="panel">
            <h2>参加可能な部屋</h2>
            <div className="roomList">
              {rooms.length === 0 && <p className="muted">部屋はまだありません。</p>}
              {rooms.map((entry) => (
                <article className="roomItem" key={entry.id}>
                  <div>
                    <strong>{entry.name}</strong>
                    <span>{entry.mode === "battle" ? "バトルロワイヤル登山" : "チーム登山"} / {presetLabel(entry.preset)} / {entry.playerCount} / {entry.maxPlayers}</span>
                  </div>
                  <button disabled={entry.started} onClick={() => socket?.emit("joinRoom", entry.id)}>
                    {entry.started ? "開始済み" : "参加"}
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {screen === "waiting" && room && (
        <section className="panel">
          <div className="waitingHeader">
            <div>
              <p className="eyebrow">{room.mode === "battle" ? "バトルロワイヤル登山" : "チーム登山"}</p>
              <h2>{room.name}</h2>
              <p className="muted">{presetLabel(room.preset)}</p>
            </div>
            <p>{room.players.length} / {room.maxPlayers} 開始時CPU補充</p>
          </div>
          <div className="players">
            {room.players.map((player) => (
              <span
                key={player.id}
                className={`playerCard${player.id === socket?.id ? " me" : ""}`}
                style={{ "--team-color": player.team ? teamCssColor(player.team) : player.isCpu ? "#9aa6b2" : "#ff6b6b" } as CSSProperties}
              >
                <span className="playerAvatar" aria-hidden="true">
                  <span className="playerHelmet" />
                  <span className="playerBody" />
                </span>
                <span className="playerMeta">
                  <strong>{player.name}</strong>
                  <small>{player.isCpu ? "CPU Racer" : "Player"}{player.team ? ` / Team ${player.team}` : ""}{player.id === room.ownerId ? " / Host" : ""}</small>
                </span>
              </span>
            ))}
          </div>
          {room.mode === "team" && me && !me.isCpu && !room.started && (
            <div className="teamPicker">
              {[1, 2, 3, 4].map((team) => (
                <button
                  key={team}
                  className={me.team === team ? "active" : ""}
                  onClick={() => socket?.emit("setTeam", team)}
                  style={{ borderColor: teamCssColor(team), color: me.team === team ? "#17202a" : teamCssColor(team), background: me.team === team ? teamCssColor(team) : undefined }}
                >
                  Team {team}
                </button>
              ))}
            </div>
          )}
          {isOwner && <button className="primary" onClick={() => socket?.emit("startGame")}>開始</button>}
        </section>
      )}

      {screen === "game" && room && socket && (
        <section className={`gameWrap${isLastSpurt ? " lastSpurt" : ""}`}>
          <div className="hud left">順位 {socket.id ? rankOf(room, socket.id) : "-"} / {room.players.length} 位</div>
          <div className="hud right">高度 {Math.round(me?.altitude || 0)}m</div>
          {countdownLabel && <div className="countdown">{countdownLabel}</div>}
          {isLastSpurt && !countdownLabel && <div className="lastSpurtBanner">LAST SPURT</div>}
          <SkyRushGame socket={socket} room={room} />
        </section>
      )}

      {screen === "result" && (
        <section className="panel">
          <h2>リザルト</h2>
          {room?.winnerId && <p className="winner">Winner: {room.players.find((player) => player.id === room.winnerId)?.name}</p>}
          {room?.winningTeam && <p className="winner">Winning Team: Team {room.winningTeam}</p>}
          <table>
            <thead>
              <tr><th>順位</th><th>プレイヤー</th><th>高度</th><th>ゴール時間</th></tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr key={`${row.rank}-${row.playerName}`}>
                  <td>{row.rank}</td>
                  <td>{row.playerName}{row.team ? ` / T${row.team}` : ""}</td>
                  <td>{row.altitude}m</td>
                  <td>{row.goalTimeMs ? `${(row.goalTimeMs / 1000).toFixed(2)}s` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="primary" onClick={leaveToLobby}>ロビーへ戻る</button>
        </section>
      )}
    </main>
  );
}

function rankOf(room: RoomState, socketId: string) {
  const sorted = [...room.players].sort((a, b) => b.altitude - a.altitude);
  return sorted.findIndex((player) => player.id === socketId) + 1;
}

function presetLabel(preset: StagePreset) {
  return {
    balanced: "バランス型",
    boost: "消える床多め",
    stretch: "伸縮バー多め",
    teamwork: "チーム協力多め"
  }[preset];
}

function teamCssColor(team: number) {
  return ["#ff6b6b", "#4dabf7", "#51cf66", "#ffd43b"][team - 1] || "#ffffff";
}
