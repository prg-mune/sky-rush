export type GameMode = "battle" | "team";
export type StagePreset = "balanced" | "boost" | "stretch" | "teamwork";

export type LoginSession = {
  playerName: string;
};

export type RoomSummary = {
  id: string;
  name: string;
  mode: GameMode;
  preset: StagePreset;
  playerCount: number;
  maxPlayers: number;
  started: boolean;
};

export type PlayerSnapshot = {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: "left" | "right";
  jumping: boolean;
  altitude: number;
  connected: boolean;
  isCpu?: boolean;
  team?: number;
  finishedAt?: number;
};

export type RoomState = {
  id: string;
  name: string;
  mode: GameMode;
  preset: StagePreset;
  maxPlayers: number;
  ownerId: string;
  started: boolean;
  winnerId?: string;
  winningTeam?: number;
  startedAt?: number;
  finishedAt?: number;
  serverTime: number;
  players: PlayerSnapshot[];
};

export type EffectBurst = {
  kind: "push" | "jump";
  x: number;
  y: number;
};

export type ClientInput = {
  left: boolean;
  right: boolean;
  jump: boolean;
  jumpHeldMs: number;
  jumpRequestId: number;
  seq: number;
};

export type ResultRow = {
  rank: number;
  playerName: string;
  altitude: number;
  goalTimeMs?: number;
  team?: number;
};

export type ServerToClientEvents = {
  rooms: (rooms: RoomSummary[]) => void;
  roomState: (room: RoomState) => void;
  gameStarted: (room: RoomState) => void;
  gameState: (room: RoomState) => void;
  gameEnded: (payload: { room: RoomState; results: ResultRow[] }) => void;
  effectBurst: (payload: EffectBurst) => void;
  errorMessage: (message: string) => void;
};

export type ClientToServerEvents = {
  login: (payload: { playerName: string; password: string }, cb: (ok: boolean, message?: string) => void) => void;
  listRooms: () => void;
  createRoom: (payload: { name: string; mode: GameMode; maxPlayers: number; preset: StagePreset }) => void;
  joinRoom: (roomId: string) => void;
  leaveRoom: () => void;
  startGame: () => void;
  setTeam: (team: number) => void;
  input: (input: ClientInput) => void;
};
