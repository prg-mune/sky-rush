import dynamic from "next/dynamic";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  DifficultyMode,
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
type NoticeKind = "info" | "success" | "warning" | "error";
type Notice = { kind: NoticeKind; text: string };
type ConnectionStatus = "connecting" | "online" | "offline";
const SESSION_STORAGE_KEY = "sky-rush-session-id";
const BUILD_COMMIT = process.env.NEXT_PUBLIC_COMMIT_SHA || "dev";
const enabledStageIds = new Set<StageId>(["battle_01_garden", "battle_03_cloud_jumble", "battle_07_cup_qualifier", "battle_10_everest_rush", "team_01_skybase"]);
const playerColors = ["#ff6b6b", "#4dabf7", "#51cf66", "#ffd43b", "#da77f2", "#20c997", "#ff922b", "#f06595"];

const stageOptions: StageOption[] = [
  { id: "battle_01_garden", mode: "battle", name: "はじまりの空庭", difficulty: "初級", climbHeight: 2000, description: "足場広めの基本コース" },
  { id: "battle_03_cloud_jumble", mode: "battle", name: "雲間ジャンブル", difficulty: "初中級", climbHeight: 5000, description: "足場が散って押し合いが起きやすい" },
  { id: "battle_07_cup_qualifier", mode: "battle", name: "スカイラッシュ杯 予選", difficulty: "中上級", climbHeight: 5000, description: "20人対戦向けの混合コース" },
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [roomName, setRoomName] = useState("");
  const [roomPasscodeEnabled, setRoomPasscodeEnabled] = useState(false);
  const [roomPasscode, setRoomPasscode] = useState("");
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [joinPasscode, setJoinPasscode] = useState("");
  const [mode, setMode] = useState<GameMode>("battle");
  const [difficulty, setDifficulty] = useState<DifficultyMode>("normal");
  const [stageId, setStageId] = useState<StageId>("battle_01_garden");
  const [maxPlayers, setMaxPlayers] = useState(5);
  const [spectatingPlayerId, setSpectatingPlayerId] = useState<string | undefined>();
  const [broadcastMode, setBroadcastMode] = useState(false);
  const [roleChanging, setRoleChanging] = useState(false);
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    const nextSocket: TypedSocket = io({ transports: ["websocket"] });
    setSocket(nextSocket);
    nextSocket.on("connect", () => {
      setIsConnected(true);
      setConnectionStatus("online");
      setNotice((current) => current ? { kind: "success", text: "サーバーへ再接続しました" } : current);
    });
    nextSocket.on("disconnect", () => {
      setIsConnected(false);
      setConnectionStatus("offline");
      setNotice({ kind: "warning", text: "通信が切れました。再接続を試しています" });
    });
    nextSocket.on("connect_error", () => {
      setIsConnected(false);
      setConnectionStatus("offline");
      setNotice({ kind: "error", text: "サーバーへ接続できません" });
    });
    nextSocket.io.on("reconnect_attempt", () => {
      setConnectionStatus("connecting");
      setNotice({ kind: "info", text: "サーバーへ再接続しています" });
    });
    nextSocket.on("rooms", setRooms);
    nextSocket.on("roomState", (nextRoom) => {
      setRoom(nextRoom);
      const owner = nextRoom.players.find((player) => player.id === nextSocket.id);
      if (nextRoom.started && nextRoom.ownerId === nextSocket.id && owner?.spectator) setBroadcastMode(true);
      setScreen(nextRoom.started ? "game" : "waiting");
    });
    nextSocket.on("gameStarted", (nextRoom) => {
      setRoom(nextRoom);
      const owner = nextRoom.players.find((player) => player.id === nextSocket.id);
      if (nextRoom.ownerId === nextSocket.id && owner?.spectator) setBroadcastMode(true);
      setScreen("game");
    });
    nextSocket.on("gameState", setRoom);
    nextSocket.on("gameEnded", ({ room: endedRoom, results: endedResults }) => {
      setRoom(endedRoom);
      setResults(endedResults);
      setScreen("result");
    });
    nextSocket.on("removedFromRoom", (reason) => {
      setRoom(null);
      setResults([]);
      setBroadcastMode(false);
      setScreen("lobby");
      setNotice({ kind: "warning", text: reason });
      nextSocket.emit("listRooms");
    });
    nextSocket.on("errorMessage", (text) => setNotice({ kind: "error", text }));
    return () => {
      nextSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!notice || notice.kind === "error" || notice.kind === "warning") return;
    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
    () => room?.players
      .filter((player) => !player.spectator && !player.retiredAt)
      .reduce<PlayerSnapshot | undefined>((best, player) => (!best || player.altitude > best.altitude ? player : best), undefined),
    [room]
  );
  const watchablePlayers = useMemo(
    () => room?.players.filter((player) => player.connected && !player.finishedAt && !player.retiredAt && !player.spectator).sort((a, b) => b.altitude - a.altitude) ?? [],
    [room]
  );
  const liveLeaderboard = useMemo(
    () => [...(room?.players ?? [])].filter((player) => !player.spectator).sort((a, b) => {
      if (a.finishedAt && b.finishedAt) return a.finishedAt - b.finishedAt;
      if (a.finishedAt) return -1;
      if (b.finishedAt) return 1;
      if (a.retiredAt && b.retiredAt) return b.retiredAt - a.retiredAt;
      if (a.retiredAt) return 1;
      if (b.retiredAt) return -1;
      return b.altitude - a.altitude;
    }),
    [room]
  );
  const broadcastCandidates = useMemo(() => {
    const active = watchablePlayers.filter((player) => player.id !== socket?.id);
    return active.length > 0 ? active : watchablePlayers;
  }, [socket?.id, watchablePlayers]);
  const spectatingPlayer = useMemo(
    () => room?.players.find((player) => player.id === spectatingPlayerId),
    [room, spectatingPlayerId]
  );
  const isOwner = Boolean(room && socket?.id === room.ownerId);
  const racerCount = room?.players.filter((player) => !player.spectator).length ?? 0;
  const spectatorCount = room?.players.filter((player) => player.spectator).length ?? 0;
  const selectableStages = useMemo(() => stageOptions.filter((stage) => stage.mode === mode), [mode]);
  const synchronizedNow = room?.serverTime ?? Date.now();
  const countdownMs = Math.max(0, (room?.startedAt || 0) - synchronizedNow);
  const countdownLabel = countdownMs > 0 ? Math.ceil(countdownMs / 1000).toString() : "";
  const matchTimeLeftMs = Math.max(0, (room?.timeoutAt || 0) - synchronizedNow);
  const isLastSpurt = Boolean(me && room && me.altitude > stageClimbHeight(room.stageId) * 0.84 && !room.finishedAt);
  const isSpectator = Boolean((me?.finishedAt || me?.retiredAt || me?.spectator) && room && !room.finishedAt);

  useEffect(() => {
    if (!selectableStages.some((stage) => stage.id === stageId)) {
      setStageId(selectableStages[0]?.id ?? "battle_01_garden");
    }
  }, [selectableStages, stageId]);

  useEffect(() => {
    if (!isSpectator && !broadcastMode) {
      setSpectatingPlayerId(undefined);
      return;
    }
    const candidates = broadcastMode ? broadcastCandidates : watchablePlayers;
    if (!spectatingPlayerId || !candidates.some((player) => player.id === spectatingPlayerId)) {
      setSpectatingPlayerId(candidates[0]?.id);
    }
  }, [broadcastCandidates, broadcastMode, isSpectator, spectatingPlayerId, watchablePlayers]);

  useEffect(() => {
    if (screen !== "game") setBroadcastMode(false);
  }, [screen]);

  function login() {
    setNotice(null);
    const sessionId = window.sessionStorage.getItem(SESSION_STORAGE_KEY) || undefined;
    socket?.emit("login", { playerName, password, sessionId }, (ok, nextMessage, nextSessionId) => {
      if (ok) {
        if (nextSessionId) window.sessionStorage.setItem(SESSION_STORAGE_KEY, nextSessionId);
        setNotice({ kind: "success", text: "ログインしました" });
        setScreen("lobby");
        socket.emit("listRooms");
      } else {
        setNotice({ kind: "error", text: nextMessage || "ログインできませんでした" });
      }
    });
  }

  function createRoom() {
    if (!isConnected) {
      setNotice({ kind: "warning", text: "再接続後に部屋を作成できます" });
      return;
    }
    if (roomPasscodeEnabled && !/^\d{4}$/.test(roomPasscode)) {
      setNotice({ kind: "warning", text: "部屋のパスコードは4桁の数字で入力してください" });
      return;
    }
    setNotice({ kind: "info", text: "部屋を作成しています" });
    socket?.emit("createRoom", {
      name: roomName,
      mode,
      difficulty,
      maxPlayers,
      stageId,
      passcode: roomPasscodeEnabled ? roomPasscode.trim() : undefined
    });
  }

  function joinSelectedRoom(entry: RoomSummary, passcode?: string) {
    if (!isConnected) {
      setNotice({ kind: "warning", text: "再接続後に参加できます" });
      return;
    }
    if (entry.requiresPasscode && passcode === undefined) {
      setJoiningRoomId(entry.id);
      setJoinPasscode("");
      return;
    }
    setNotice({ kind: "info", text: "部屋へ参加しています" });
    socket?.emit("joinRoom", { roomId: entry.id, passcode: passcode?.trim() }, (ok, message) => {
      if (ok) {
        setJoiningRoomId(null);
        setJoinPasscode("");
        return;
      }
      setNotice({ kind: "warning", text: message || "部屋へ参加できませんでした" });
    });
  }

  function leaveToLobby() {
    socket?.emit("leaveRoom");
    socket?.emit("listRooms");
    setRoom(null);
    setResults([]);
    setScreen("lobby");
    setNotice({ kind: "info", text: "ロビーへ戻りました" });
  }

  function shiftSpectatingPlayer(direction: number) {
    const candidates = broadcastMode ? broadcastCandidates : watchablePlayers;
    if (candidates.length === 0) return;
    const currentIndex = Math.max(0, candidates.findIndex((player) => player.id === spectatingPlayerId));
    const nextIndex = (currentIndex + direction + candidates.length) % candidates.length;
    setSpectatingPlayerId(candidates[nextIndex].id);
  }

  function removePlayerFromRoom(player: PlayerSnapshot) {
    if (!window.confirm(`${player.name}を部屋から退出させますか？`)) return;
    socket?.emit("removePlayer", player.id);
  }

  function endCurrentGame() {
    if (!window.confirm("現在の試合を終了してリザルトを表示しますか？")) return;
    socket?.emit("endGame");
  }

  function retireCurrentPlayer() {
    if (!window.confirm("リタイアして観戦モードへ移りますか？")) return;
    socket?.emit("retire");
  }

  function prepareRematch() {
    socket?.emit("prepareRematch");
  }

  function changeRole(spectator: boolean) {
    if (!socket || roleChanging || me?.spectator === spectator) return;
    setRoleChanging(true);
    socket.emit("setSpectator", spectator, (ok, message) => {
      setRoleChanging(false);
      if (!ok) setNotice({ kind: "warning", text: message || "参加方法を変更できませんでした" });
    });
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1 className="titleLogo" aria-label="Sky Rush">SKY RUSH</h1>
        </div>
        <div className="topbarActions">
          <button type="button" onClick={() => setShowRules(true)}>ルール</button>
          {screen !== "login" && <button onClick={leaveToLobby}>ロビー</button>}
        </div>
      </header>

      <div className="statusRail">
        <span className={`statusDot ${connectionStatus}`} />
        <strong>{connectionStatusLabel(connectionStatus)}</strong>
        <span>{screenLabel(screen)}</span>
        {room && <span>{room.name} / {stageLabel(room.stageId)} / {difficultyLabel(room.difficulty)}</span>}
      </div>

      {notice && (
        <div className={`toast ${notice.kind}`} role="status">
          <strong>{noticeLabel(notice.kind)}</strong>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="通知を閉じる">x</button>
        </div>
      )}

      {showRules && (
        <section className="rulesOverlay" role="dialog" aria-modal="true" aria-label="ルール">
          <div className="rulesPanel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">Rules</p>
                <h2>遊び方</h2>
              </div>
              <button type="button" onClick={() => setShowRules(false)}>閉じる</button>
            </div>
            <div className="rulesGrid">
              <article className="ruleCard">
                <h3>基本操作</h3>
                <p>左右キーまたはA/Dで移動。ジャンプはSpace、スマホはタップ/長押し。長くためるほど高く飛べます。</p>
              </article>
              <article className="ruleCard">
                <h3>勝利条件</h3>
                <p>コース上部のゴールを目指します。CPU以外の参加者が全員ゴールするか、制限時間になると結果発表です。</p>
              </article>
              <article className="ruleCard">
                <h3>対戦</h3>
                <p>ほかのプレイヤーとは押し合えます。ゴール後は鑑賞モードで、まだ登っている人の画面へ切り替えできます。</p>
              </article>
              <article className="ruleCard">
                <h3>チーム登山</h3>
                <p>同じチームの仲間は色が統一されます。味方の上に乗ってジャンプすると、協力エリアの高い壁を越えやすくなります。</p>
              </article>
              <article className="ruleCard">
                <h3>足場の種類</h3>
                <div className="barLegend">
                  <span><i className="normal" />通常</span>
                  <span><i className="stretch" />伸縮</span>
                  <span><i className="vanish" />消える</span>
                  <span><i className="moving" />移動</span>
                </div>
              </article>
              <article className="ruleCard">
                <h3>難易度</h3>
                <p>ノーマルは足場の種類ごとに色が付きます。ハードではゴール以外の足場がグレーになります。</p>
              </article>
            </div>
          </div>
        </section>
      )}

      {screen === "login" && (
        <section className="panel auth">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Entry Gate</p>
              <h2>ログイン</h2>
            </div>
            <span className="panelBadge">v1.1 · build {BUILD_COMMIT}</span>
          </div>
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
            パスコード
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="text"
              placeholder="progress4649"
              autoComplete="one-time-code"
              inputMode="text"
              name="sky-rush-entry-code"
              className="passcodeInput"
            />
          </label>
          <button className="primary" disabled={!isConnected || !playerName.trim() || !password} onClick={login}>入る</button>
        </section>
      )}

      {screen === "lobby" && (
        <section className="grid two">
          <div className="panel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">Create Match</p>
                <h2>部屋を作成</h2>
              </div>
              <span className="panelBadge">{maxPlayers} Racers</span>
            </div>
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
            <div className="difficultyPicker">
              <span>難易度</span>
              <div role="group" aria-label="難易度">
                {(["normal", "hard"] as DifficultyMode[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={difficulty === option ? "active" : ""}
                    aria-pressed={difficulty === option}
                    onClick={() => setDifficulty(option)}
                  >
                    <strong>{option.toUpperCase()}</strong>
                    <small>{option === "normal" ? "カラーあり" : "ノーカラー"}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="stagePicker">
              <span className="stagePickerLabel">ステージ</span>
              <div className="stageOptions">
                {selectableStages.map((stage) => (
                  <button
                    key={stage.id}
                    type="button"
                    className={`stageOption${stage.id === stageId ? " active" : ""}${enabledStageIds.has(stage.id) ? "" : " disabled"}`}
                    disabled={!enabledStageIds.has(stage.id)}
                    onClick={() => setStageId(stage.id)}
                  >
                    <span className="stageOptionTop">
                      <strong>{stage.name}</strong>
                      <span>{enabledStageIds.has(stage.id) ? stage.difficulty : "未調整"}</span>
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
              <input type="range" min={2} max={20} value={maxPlayers} onChange={(event) => setMaxPlayers(Number(event.target.value))} />
            </label>
            <div className="passcodeSetting">
              <div>
                <strong>入室パスコード</strong>
                <small>招待したメンバーだけ参加できます</small>
              </div>
              <label className="switchControl">
                <input
                  type="checkbox"
                  checked={roomPasscodeEnabled}
                  onChange={(event) => {
                    setRoomPasscodeEnabled(event.target.checked);
                    if (!event.target.checked) setRoomPasscode("");
                  }}
                />
                <span>{roomPasscodeEnabled ? "あり" : "なし"}</span>
              </label>
            </div>
            {roomPasscodeEnabled && (
              <label>
                部屋のパスコード
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  name="sky-rush-room-passcode"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  value={roomPasscode}
                  onChange={(event) => setRoomPasscode(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="4桁の数字"
                />
              </label>
            )}
            <button
              className="primary"
              disabled={!isConnected || !enabledStageIds.has(stageId) || (roomPasscodeEnabled && !/^\d{4}$/.test(roomPasscode))}
              onClick={createRoom}
            >
              作成
            </button>
          </div>
          <div className="panel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">Match List</p>
                <h2>参加可能な部屋</h2>
              </div>
              <span className="panelBadge">{rooms.length} Rooms</span>
            </div>
            <div className="roomList">
              {rooms.length === 0 && <p className="muted">部屋はまだありません。</p>}
              {rooms.map((entry) => (
                <article className="roomItem" key={entry.id}>
                  <div>
                    <strong>{entry.name}</strong>
                    <span>{entry.mode === "battle" ? "バトルロワイヤル登山" : "チーム登山"} / {stageLabel(entry.stageId)}</span>
                    <span className="roomBadges">
                      <small>出走 {entry.playerCount} / {entry.maxPlayers}</small>
                      {entry.spectatorCount > 0 && <small>観戦 {entry.spectatorCount}</small>}
                      <small>{difficultyLabel(entry.difficulty)}</small>
                      {entry.requiresPasscode && <small className="lockedBadge">PASSCODE</small>}
                      <small>{entry.started ? "STARTED" : "OPEN"}</small>
                    </span>
                  </div>
                  <div className="roomJoinActions">
                    {joiningRoomId === entry.id && entry.requiresPasscode ? (
                      <>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          name={`sky-rush-join-${entry.id}`}
                          pattern="[0-9]{4}"
                          maxLength={4}
                          value={joinPasscode}
                          onChange={(event) => setJoinPasscode(event.target.value.replace(/\D/g, "").slice(0, 4))}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && /^\d{4}$/.test(joinPasscode)) joinSelectedRoom(entry, joinPasscode);
                          }}
                          placeholder="4桁"
                          aria-label={`${entry.name}のパスコード`}
                          autoFocus
                        />
                        <button disabled={!isConnected || !/^\d{4}$/.test(joinPasscode)} onClick={() => joinSelectedRoom(entry, joinPasscode)}>入室</button>
                        <button className="compactButton" onClick={() => setJoiningRoomId(null)} aria-label="パスコード入力を閉じる">閉じる</button>
                      </>
                    ) : (
                      <button disabled={!isConnected || entry.started} onClick={() => joinSelectedRoom(entry)}>
                        {entry.started ? "開始済み" : entry.requiresPasscode ? "コード入力" : "参加"}
                      </button>
                    )}
                  </div>
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
            <div className="matchStats">
              <span><strong>{racerCount} / {room.maxPlayers}</strong><small>Racers</small></span>
              <span><strong>{spectatorCount}</strong><small>Spectators</small></span>
              <span><strong>{room.players.filter((player) => player.connected).length}</strong><small>Online</small></span>
              <span><strong>{stageClimbHeight(room.stageId)}m</strong><small>Course</small></span>
              <span><strong>{difficultyLabel(room.difficulty)}</strong><small>Difficulty</small></span>
            </div>
          </div>
          <div className="players">
            {room.players.map((player) => (
              <span
                key={player.id}
                className={`playerCard${player.id === socket?.id ? " me" : ""}${player.connected ? "" : " disconnected"}`}
                style={{ "--team-color": displayPlayerColor(player) } as CSSProperties}
              >
                <span className="playerAvatar" aria-hidden="true">
                  <span className="playerHelmet" />
                  <span className="playerBody" />
                </span>
                <span className="playerMeta">
                  <strong>{player.name}</strong>
                  <small>{player.isCpu ? "CPU Racer" : !player.connected ? "Offline" : player.spectator ? "Spectator" : "Racer"}{!player.spectator && player.team ? ` / Team ${player.team}` : ""}{player.id === room.ownerId ? " / Host" : ""}</small>
                </span>
                {isOwner && player.id !== socket?.id && !player.isCpu && (
                  <button className="removePlayerButton" type="button" onClick={() => removePlayerFromRoom(player)} aria-label={`${player.name}を退出させる`}>退出</button>
                )}
              </span>
            ))}
          </div>
          {me && !me.isCpu && !room.started && (
            <div className="rolePicker" aria-label="参加方法">
              <span>参加方法</span>
              <div>
                <button className={!me.spectator ? "active" : ""} disabled={roleChanging} onClick={() => changeRole(false)}>出走する</button>
                <button className={me.spectator ? "active" : ""} disabled={roleChanging} onClick={() => changeRole(true)}>観戦する</button>
              </div>
              <small>{me.spectator ? "順位と接触判定には入りません" : `出走枠 ${racerCount} / ${room.maxPlayers}`}</small>
            </div>
          )}
          {room.mode === "team" && me && !me.isCpu && !me.spectator && !room.started && (
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
          {room.mode === "battle" && me && !me.isCpu && !me.spectator && !room.started && (
            <div className="colorPicker" aria-label="プレイヤーカラー">
              {playerColors.map((color) => (
                <button
                  key={color}
                  className={me.color === color ? "active" : ""}
                  onClick={() => socket?.emit("setColor", color)}
                  style={{ "--swatch-color": color } as CSSProperties}
                  aria-label={`色 ${color}`}
                />
              ))}
            </div>
          )}
          <div className="actionBar">
            {isOwner ? <button className="primary" disabled={!isConnected || roleChanging} onClick={() => socket?.emit("startGame")}>試合開始</button> : <span className="muted">Host: {room.players.find((player) => player.id === room.ownerId)?.name}</span>}
          </div>
        </section>
      )}

      {screen === "game" && room && socket && (
        <section className={`gameWrap${isLastSpurt ? " lastSpurt" : ""}${broadcastMode ? " broadcastMode" : ""}`}>
          <div className="hud left">
            {broadcastMode ? (
              <>
                LIVE<span className="broadcastStage"> / {stageLabel(room.stageId)}</span>
              </>
            ) : isSpectator ? "観戦モード" : `順位 ${socket.id ? rankOf(room, socket.id) : "-"} / ${liveLeaderboard.length} 位`}
          </div>
          {room.timeoutAt && !countdownLabel && (
            <div className="hud center">残り {formatTime(matchTimeLeftMs)}</div>
          )}
          {!broadcastMode && (
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
          )}
          {broadcastMode && !countdownLabel && (
            <aside className="broadcastBoard" aria-label="ライブ順位">
              <div className="broadcastBoardHeader">
                <span className="liveDot" />
                <strong>LIVE RANKING</strong>
              </div>
              <ol>
                {liveLeaderboard.slice(0, 8).map((player, index) => (
                  <li key={player.id} className={player.id === spectatingPlayerId ? "focused" : ""}>
                    <b>{index + 1}</b>
                    <span>{player.name}</span>
                    <strong>{player.finishedAt ? "GOAL" : player.retiredAt ? "RETIRED" : `${Math.round(player.altitude)}m`}</strong>
                  </li>
                ))}
              </ol>
            </aside>
          )}
          {countdownLabel && <div className="countdown">{countdownLabel}</div>}
          {isLastSpurt && !countdownLabel && <div className="lastSpurtBanner">LAST SPURT</div>}
          {(isSpectator || broadcastMode) && (
            <div className="spectatorPanel">
              <strong>{broadcastMode ? "大会中継" : "観戦中"}</strong>
              <span>{spectatingPlayer ? `${spectatingPlayer.name} / ${Math.round(spectatingPlayer.altitude)}m` : "全員ゴール待ち"}</span>
              <div>
                <button disabled={(broadcastMode ? broadcastCandidates : watchablePlayers).length <= 1} onClick={() => shiftSpectatingPlayer(-1)}>前へ</button>
                <button disabled={(broadcastMode ? broadcastCandidates : watchablePlayers).length <= 1} onClick={() => shiftSpectatingPlayer(1)}>次へ</button>
              </div>
            </div>
          )}
          {isOwner && (
            <div className="hostMatchControls">
              <strong>HOST</strong>
              {me?.spectator && (
                <button type="button" className={broadcastMode ? "active" : ""} onClick={() => setBroadcastMode((current) => !current)}>
                  {broadcastMode ? "中継を終了" : "中継モード"}
                </button>
              )}
              <button type="button" className="danger" onClick={endCurrentGame}>試合終了</button>
            </div>
          )}
          {!countdownLabel && me && !me.isCpu && !me.spectator && !me.finishedAt && !me.retiredAt && (
            <div className="playerMatchControls">
              <button type="button" className="retireButton" onClick={retireCurrentPlayer}>リタイア</button>
            </div>
          )}
          <SkyRushGame socket={socket} room={room} spectatingPlayerId={spectatingPlayerId} inputDisabled={broadcastMode || Boolean(me?.spectator || me?.retiredAt)} />
        </section>
      )}

      {screen === "result" && (
        <section className="panel resultPanel">
          <div className="resultHero">
            <p className="eyebrow">Result Board</p>
            <h2>リザルト</h2>
            {room?.winnerId && <p className="winner">Winner: {room.players.find((player) => player.id === room.winnerId)?.name}</p>}
            {room?.winningTeam && <p className="winner">Winning Team: Team {room.winningTeam}</p>}
          </div>
          <table>
            <thead>
              <tr><th>順位</th><th>プレイヤー</th><th>高度</th><th>結果 / ゴール時間</th></tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr key={`${row.rank}-${row.playerName}`}>
                  <td>{row.rank}</td>
                  <td>{row.playerName}{row.team ? ` / T${row.team}` : ""}</td>
                  <td>{row.altitude}m</td>
                  <td>{row.retired ? "RETIRED" : row.goalTimeMs ? `${(row.goalTimeMs / 1000).toFixed(2)}s` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actionBar">
            {isOwner && <button onClick={prepareRematch}>同じ設定で再戦</button>}
            <button className="primary" onClick={leaveToLobby}>ロビーへ戻る</button>
          </div>
        </section>
      )}
    </main>
  );
}

function rankOf(room: RoomState, socketId: string) {
  const sorted = room.players.filter((player) => !player.spectator && !player.retiredAt).sort((a, b) => b.altitude - a.altitude);
  return sorted.findIndex((player) => player.id === socketId) + 1;
}

function screenLabel(screen: Screen) {
  const labels: Record<Screen, string> = {
    login: "ENTRY",
    lobby: "LOBBY",
    waiting: "READY ROOM",
    game: "MATCH",
    result: "RESULT"
  };
  return labels[screen];
}

function connectionStatusLabel(status: ConnectionStatus) {
  const labels: Record<ConnectionStatus, string> = {
    connecting: "CONNECTING",
    online: "ONLINE",
    offline: "OFFLINE"
  };
  return labels[status];
}

function difficultyLabel(difficulty: DifficultyMode) {
  return difficulty === "hard" ? "HARD" : "NORMAL";
}

function noticeLabel(kind: NoticeKind) {
  const labels: Record<NoticeKind, string> = {
    info: "INFO",
    success: "OK",
    warning: "WAIT",
    error: "ERROR"
  };
  return labels[kind];
}

function altitudeProgress(altitude: number, stageId: StageId) {
  const climbHeight = stageClimbHeight(stageId);
  return Math.max(0, Math.min(100, (altitude / climbHeight) * 100));
}

function formatTime(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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

function displayPlayerColor(player: PlayerSnapshot) {
  if (player.isCpu) return "#9aa6b2";
  if (player.team) return teamCssColor(player.team);
  return player.color || "#ff6b6b";
}

function teamCssColor(team: number) {
  return ["#ff6b6b", "#4dabf7", "#51cf66", "#ffd43b"][team - 1] || "#ffffff";
}
