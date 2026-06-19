import dynamic from "next/dynamic";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  GameMode,
  PlayerSnapshot,
  ResultRow,
  RoomState,
  RoomSummary,
  ServerToClientEvents,
  StageId
} from "../shared/types";

const SkyRushGame = dynamic(() => import("../src/SkyRushGame"), { ssr: false });

type Screen = "login" | "lobby" | "waiting" | "game" | "result";
type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type StageOption = { id: StageId; mode: GameMode; name: string; difficulty: string; climbHeight: number; description: string };
const SESSION_STORAGE_KEY = "sky-rush-session-id";

const stageOptions: StageOption[] = [
  { id: "battle_01_garden", mode: "battle", name: "はじまりの空庭", difficulty: "初級", climbHeight: 2000, description: "足場広めの基本コース" },
  { id: "battle_02_breeze", mode: "battle", name: "そよ風ステップ", difficulty: "初級", climbHeight: 2000, description: "少しだけ左右移動が増える" },
  { id: "battle_03_cloud_jumble", mode: "battle", name: "雲間ジャンブル", difficulty: "初中級", climbHeight: 5000, description: "足場が散って押し合いが起きやすい" },
  { id: "battle_04_sunset_bridge", mode: "battle", name: "夕焼けブリッジ", difficulty: "初中級", climbHeight: 5000, description: "長い橋と短い消える床のミックス" },
  { id: "battle_05_wobble_highland", mode: "battle", name: "ぐらつき高原", difficulty: "中級", climbHeight: 5000, description: "伸縮バー多め" },
  { id: "battle_06_phantom_corridor", mode: "battle", name: "まぼろし回廊", difficulty: "中級", climbHeight: 5000, description: "消える床の練習向き" },
  { id: "battle_07_cup_qualifier", mode: "battle", name: "スカイラッシュ杯 予選", difficulty: "中上級", climbHeight: 5000, description: "20人対戦向けの混合コース" },
  { id: "battle_08_lightning_ridge", mode: "battle", name: "稲妻リッジ", difficulty: "上級", climbHeight: 8000, description: "短い足場と消える床が多い" },
  { id: "battle_09_stratos_ladder", mode: "battle", name: "成層圏ラダー", difficulty: "上級", climbHeight: 8000, description: "後半リカバリーが難しい" },
  { id: "battle_10_everest_rush", mode: "battle", name: "エベレスト・ラッシュ", difficulty: "超上級", climbHeight: 8000, description: "ほとんど消える床の最難関" },
  { id: "team_01_skybase", mode: "team", name: "チーム・スカイベース", difficulty: "初級", climbHeight: 2000, description: "味方踏み台と高壁の協力コース" }
];

export default function Home() {
  const [socket, setSocket] = useState<TypedSocket | null>(null);
  const [screen, setScreen] = useState<Screen>("login");
  const [playerName, setPlayerName] = useState("");
  const [password, setPassword] = useState("");
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [message, setMessage] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [mode, setMode] = useState<GameMode>("battle");
  const [stageId, setStageId] = useState<StageId>("battle_01_garden");
  const [maxPlayers, setMaxPlayers] = useState(20);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const nextSocket: TypedSocket = io({ transports: ["websocket"] });
    setSocket(nextSocket);
    nextSocket.on("connect", () => setIsConnected(true));
    nextSocket.on("disconnect", () => setIsConnected(false));
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

  useEffect(() => {
    if (!socket || screen === "login" || !playerName || !password) return;
    const reconnect = () => {
      const sessionId = window.sessionStorage.getItem(SESSION_STORAGE_KEY) || undefined;
      socket.emit("login", { playerName, password, sessionId }, (ok, _message, nextSessionId) => {
        if (ok && nextSessionId) window.sessionStorage.setItem(SESSION_STORAGE_KEY, nextSessionId);
        socket.emit("listRooms");
      });
    };
    socket.on("connect", reconnect);
    return () => {
      socket.off("connect", reconnect);
    };
  }, [socket, screen, playerName, password]);

  const me = useMemo(() => room?.players.find((player) => player.id === socket?.id), [room, socket?.id]);
  const leader = useMemo<PlayerSnapshot | undefined>(
    () => room?.players.reduce((best, player) => (player.altitude > best.altitude ? player : best), room.players[0]),
    [room]
  );
  const isOwner = Boolean(room && socket?.id === room.ownerId);
  const selectableStages = useMemo(() => stageOptions.filter((stage) => stage.mode === mode), [mode]);
  const countdownMs = Math.max(0, (room?.startedAt || 0) - now);
  const countdownLabel = countdownMs > 0 ? Math.ceil(countdownMs / 1000).toString() : "";
  const isLastSpurt = Boolean(me && room && me.altitude > stageClimbHeight(room.stageId) * 0.84 && !room.finishedAt);

  useEffect(() => {
    if (!selectableStages.some((stage) => stage.id === stageId)) {
      setStageId(selectableStages[0]?.id ?? "battle_01_garden");
    }
  }, [selectableStages, stageId]);

  function login() {
    setMessage("");
    const sessionId = window.sessionStorage.getItem(SESSION_STORAGE_KEY) || undefined;
    socket?.emit("login", { playerName, password, sessionId }, (ok, nextMessage, nextSessionId) => {
      if (ok) {
        if (nextSessionId) window.sessionStorage.setItem(SESSION_STORAGE_KEY, nextSessionId);
        setScreen("lobby");
        socket.emit("listRooms");
      } else {
        setMessage(nextMessage || "ログインできませんでした");
      }
    });
  }

  function createRoom() {
    socket?.emit("createRoom", { name: roomName, mode, maxPlayers, stageId });
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

      {!isConnected && <div className="toast">サーバーへ再接続しています...</div>}
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
            <div className="stagePicker">
              <span className="stagePickerLabel">ステージ</span>
              <div className="stageOptions">
                {selectableStages.map((stage) => (
                  <button
                    key={stage.id}
                    type="button"
                    className={`stageOption${stage.id === stageId ? " active" : ""}`}
                    onClick={() => setStageId(stage.id)}
                  >
                    <span className="stageOptionTop">
                      <strong>{stage.name}</strong>
                      <span>{stage.difficulty}</span>
                    </span>
                    <span className="stageOptionMeta">
                      <span>{stage.climbHeight}m</span>
                      <small>{stage.description}</small>
                    </span>
                  </button>
                ))}
              </div>
              <span className="fieldHint">{stageDescription(stageId)}</span>
            </div>
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
                    <span>{entry.mode === "battle" ? "バトルロワイヤル登山" : "チーム登山"} / {stageLabel(entry.stageId)} / {entry.playerCount} / {entry.maxPlayers}</span>
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
              <p className="muted">{stageLabel(room.stageId)}</p>
            </div>
            <p>{room.players.length} / {room.maxPlayers} 開始時CPU補充</p>
          </div>
          <div className="players">
            {room.players.map((player) => (
              <span
                key={player.id}
                className={`playerCard${player.id === socket?.id ? " me" : ""}${player.connected ? "" : " disconnected"}`}
                style={{ "--team-color": player.team ? teamCssColor(player.team) : player.isCpu ? "#9aa6b2" : "#ff6b6b" } as CSSProperties}
              >
                <span className="playerAvatar" aria-hidden="true">
                  <span className="playerHelmet" />
                  <span className="playerBody" />
                </span>
                <span className="playerMeta">
                  <strong>{player.name}</strong>
                  <small>{player.isCpu ? "CPU Racer" : player.connected ? "Player" : "Offline"}{player.team ? ` / Team ${player.team}` : ""}{player.id === room.ownerId ? " / Host" : ""}</small>
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
          <div className="altitudeMap" aria-label="Altitude map">
            <div className="altitudeTrack">
              <span
                className="altitudeFill"
                style={{ height: `${altitudeProgress(me?.altitude || 0, room.stageId)}%` }}
              />
              {leader && (
                <span
                  className="altitudeMarker leader"
                  style={{ bottom: `${altitudeProgress(leader.altitude, room.stageId)}%` }}
                />
              )}
              {me && (
                <span
                  className="altitudeMarker me"
                  style={{ bottom: `${altitudeProgress(me.altitude, room.stageId)}%` }}
                />
              )}
            </div>
            <div className="altitudeMapLabel">
              <strong>{Math.round(me?.altitude || 0)}m</strong>
              <span>/{stageClimbHeight(room.stageId)}m</span>
            </div>
          </div>
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

function altitudeProgress(altitude: number, stageId: StageId) {
  const climbHeight = stageClimbHeight(stageId);
  return Math.max(0, Math.min(100, (altitude / climbHeight) * 100));
}

function stageLabel(stageId: StageId) {
  return stageOptions.find((stage) => stage.id === stageId)?.name ?? "はじまりの空庭";
}

function stageDescription(stageId: StageId) {
  const stage = stageOptions.find((entry) => entry.id === stageId);
  if (!stage) return "";
  return `${stage.difficulty} / 約${stage.climbHeight}m / ${stage.description}`;
}

function stageClimbHeight(stageId: StageId) {
  return stageOptions.find((stage) => stage.id === stageId)?.climbHeight ?? 2000;
}

function teamCssColor(team: number) {
  return ["#ff6b6b", "#4dabf7", "#51cf66", "#ffd43b"][team - 1] || "#ffffff";
}
