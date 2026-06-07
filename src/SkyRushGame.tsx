import { useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import type { ClientInput, ClientToServerEvents, EffectBurst, RoomState, ServerToClientEvents, StagePreset } from "../shared/types";

type Props = {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  room: RoomState;
};

type PlatformView = { x: number; y: number; w: number; h: number; kind?: "jumpPad" | "teamJumpPad" | "stretch"; minW?: number; maxW?: number; periodMs?: number; phaseMs?: number };

export default function SkyRushGame({ socket, room }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const roomRef = useRef(room);
  roomRef.current = room;

  useEffect(() => {
    let game: import("phaser").Game | null = null;
    let destroyed = false;

    async function boot() {
      const Phaser = await import("phaser");
      if (!hostRef.current || destroyed) return;

      const playerSprites = new Map<string, Phaser.GameObjects.Group>();
      const nameLabels = new Map<string, Phaser.GameObjects.Text>();
      const stretchBars: Array<{ platform: PlatformView; body: Phaser.GameObjects.Rectangle; cap: Phaser.GameObjects.Rectangle }> = [];
      const keys = { left: false, right: false, jump: false };
      let activeScene: Phaser.Scene | null = null;
      let jumpStarted = 0;
      let jumpHeldMs = 0;
      let jumpRequestId = 0;
      let lastSentAt = 0;
      let lastSentSignature = "";
      let lastSentJumpRequestId = 0;
      let seq = 0;

      class MainScene extends Phaser.Scene {
        private cameraTarget?: Phaser.GameObjects.Rectangle;

        create() {
          activeScene = this;
          this.cameras.main.setBounds(0, 0, 2200, 4300);
          this.world();
          this.cameraTarget = this.add.rectangle(1100, 3950, 1, 1).setVisible(false);
          this.cameras.main.startFollow(this.cameraTarget, true, 0.12, 0.16);
          window.addEventListener("keydown", onKeyDown);
          window.addEventListener("keyup", onKeyUp);
        }

        update() {
          const me = roomRef.current.players.find((player) => player.id === socket.id);
          if (me && this.cameraTarget) this.cameraTarget.setPosition(me.x, me.y);
          syncSprites(this, Phaser, playerSprites, nameLabels, roomRef.current);
          updateStretchBars(stretchBars);
          sendInput(performance.now());
        }

        destroy() {
          activeScene = null;
          window.removeEventListener("keydown", onKeyDown);
          window.removeEventListener("keyup", onKeyUp);
        }

        private world() {
          this.add.rectangle(1100, 2150, 2200, 4300, 0x102538);
          for (let y = 0; y < 4300; y += 220) {
            this.add.line(0, y, 0, 0, 2200, 0, 0x203f5a, 0.45);
          }
          this.add.rectangle(1100, 160, 440, 42, 0xf5d76e);
          this.add.text(992, 134, "GOAL", { fontFamily: "Arial", fontSize: "28px", color: "#17202a", fontStyle: "bold" });
          activePlatforms(roomRef.current.mode, roomRef.current.preset).forEach((platform, index) => {
            const isJumpPad = platform.kind === "jumpPad" || platform.kind === "teamJumpPad";
            const isTeamPad = platform.kind === "teamJumpPad";
            const isStretch = platform.kind === "stretch";
            const color = isStretch ? 0xf783ac : isTeamPad ? 0x74c0fc : isJumpPad ? 0x8ce99a : index % 3 === 1 ? 0x74c69d : index % 3 === 2 ? 0x89cff0 : 0xe9c46a;
            const body = this.add.rectangle(platform.x + platform.w / 2, platform.y + platform.h / 2, platform.w, platform.h, color).setStrokeStyle(2, isStretch ? 0xffdeeb : isTeamPad ? 0xd0ebff : isJumpPad ? 0xeaff8f : 0xffffff, 0.7);
            if (isStretch) {
              const cap = this.add.rectangle(platform.x + platform.w / 2, platform.y + platform.h / 2, Math.max(20, platform.w - 34), 6, 0xffdeeb, 0.75);
              stretchBars.push({ platform, body, cap });
            }
            if (isJumpPad) {
              this.add.triangle(platform.x + platform.w / 2, platform.y - 12, 0, 16, 18, 16, 9, 0, isTeamPad ? 0xd0ebff : 0xeaff8f, 0.9);
            }
            if (isTeamPad) {
              this.add.text(platform.x + platform.w / 2 - 58, platform.y - 42, "TEAM BOOST", {
                fontFamily: "Arial",
                fontSize: "18px",
                color: "#d0ebff",
                stroke: "#102538",
                strokeThickness: 4
              });
            }
          });
          if (roomRef.current.mode === "team") {
            this.add.rectangle(1100, 1420, 500, 520, 0x2f4858, 0.34).setStrokeStyle(4, 0xd0ebff, 0.32);
            this.add.text(930, 1360, "TEAM WALL", { fontFamily: "Arial", fontSize: "26px", color: "#d0ebff", stroke: "#102538", strokeThickness: 5 });
          }
          for (let y = 160; y < 4200; y += 160) {
            const bounds = courseBoundsAt(y);
            const nextBounds = courseBoundsAt(y + 160);
            this.add.line(0, 0, bounds.left, y, nextBounds.left, y + 160, 0x6f8795, 0.9).setLineWidth(10);
            this.add.line(0, 0, bounds.right, y, nextBounds.right, y + 160, 0x6f8795, 0.9).setLineWidth(10);
          }
        }
      }

      function onKeyDown(event: KeyboardEvent) {
        if (event.code === "KeyA" || event.code === "ArrowLeft") keys.left = true;
        if (event.code === "KeyD" || event.code === "ArrowRight") keys.right = true;
        if (event.code === "Space") {
          if (!keys.jump) jumpStarted = performance.now();
          keys.jump = true;
          event.preventDefault();
        }
      }

      function onKeyUp(event: KeyboardEvent) {
        if (event.code === "KeyA" || event.code === "ArrowLeft") keys.left = false;
        if (event.code === "KeyD" || event.code === "ArrowRight") keys.right = false;
        if (event.code === "Space") {
          if (keys.jump) {
            jumpHeldMs = performance.now() - jumpStarted;
            jumpRequestId += 1;
          }
          keys.jump = false;
          event.preventDefault();
        }
      }

      function currentInput(seqValue: number): ClientInput {
        const heldMs = keys.jump ? performance.now() - jumpStarted : jumpHeldMs;
        return {
          left: keys.left,
          right: keys.right,
          jump: keys.jump,
          jumpHeldMs: heldMs,
          jumpRequestId,
          seq: seqValue
        };
      }

      function inputSignature() {
        return `${Number(keys.left)}:${Number(keys.right)}:${Number(keys.jump)}:${jumpRequestId}:${Math.round((keys.jump ? performance.now() - jumpStarted : jumpHeldMs) / 50)}`;
      }

      function sendInput(now: number) {
        const signature = inputSignature();
        const jumpRequested = jumpRequestId !== lastSentJumpRequestId;
        const changed = signature !== lastSentSignature;
        const intervalElapsed = now - lastSentAt >= 50;
        if (!jumpRequested && !changed && !intervalElapsed) return;
        if (!jumpRequested && changed && now - lastSentAt < 50) return;

        seq += 1;
        socket.emit("input", currentInput(seq));
        lastSentAt = now;
        lastSentSignature = signature;
        lastSentJumpRequestId = jumpRequestId;
      }

      function onEffectBurst(effect: EffectBurst) {
        if (!activeScene) return;
        spawnEffect(activeScene, Phaser, effect);
      }

      socket.on("effectBurst", onEffectBurst);

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: 960,
        height: 640,
        backgroundColor: "#102538",
        scene: MainScene,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }
      });
    }

    boot();
    return () => {
      destroyed = true;
      socket.off("effectBurst");
      game?.destroy(true);
    };
  }, [socket]);

  return <div ref={hostRef} className="gameCanvas" />;
}

function syncSprites(
  scene: import("phaser").Scene,
  Phaser: typeof import("phaser"),
  groups: Map<string, import("phaser").GameObjects.Group>,
  labels: Map<string, import("phaser").GameObjects.Text>,
  room: RoomState
) {
  const active = new Set(room.players.map((player) => player.id));
  for (const player of room.players) {
    let group = groups.get(player.id);
    let label = labels.get(player.id);
    if (!group) {
      const body = scene.add.rectangle(0, 0, 34, 46, player.team ? teamColor(player.team) : player.isCpu ? 0xb8c0cc : 0xff6b6b).setStrokeStyle(2, 0xffffff);
      const face = scene.add.circle(8, -8, 4, 0xffffff);
      group = scene.add.group([body, face]);
      label = scene.add.text(0, 0, player.name, { fontFamily: "Arial", fontSize: "15px", color: "#ffffff", stroke: "#000000", strokeThickness: 3 });
      groups.set(player.id, group);
      labels.set(player.id, label);
    }
    group.getChildren().forEach((child) => {
      const object = child as import("phaser").GameObjects.Shape;
      object.setPosition(player.x + 17 + (object.type === "Arc" ? (player.facing === "right" ? 8 : -8) : 0), player.y + 23);
      object.setAlpha(player.connected ? 1 : 0.35);
    });
    label?.setPosition(player.x - 14, player.y - 28);
  }
  for (const [id, group] of groups) {
    if (!active.has(id)) {
      group.destroy(true);
      groups.delete(id);
      labels.get(id)?.destroy();
      labels.delete(id);
    }
  }
}

function teamColor(team: number) {
  return [0xff6b6b, 0x4dabf7, 0x51cf66, 0xffd43b, 0xda77f2][team % 5];
}

function spawnEffect(scene: import("phaser").Scene, Phaser: typeof import("phaser"), effect: EffectBurst) {
  const color = effect.kind === "jumpPad" ? 0xeaff8f : 0xffffff;
  const count = effect.kind === "jumpPad" ? 12 : 7;
  for (let i = 0; i < count; i += 1) {
    const particle = scene.add.circle(effect.x, effect.y, effect.kind === "jumpPad" ? 5 : 3, color, 0.88);
    const angle = effect.kind === "jumpPad" ? -Math.PI / 2 + (Math.random() - 0.5) * 1.4 : Math.random() * Math.PI * 2;
    const distance = effect.kind === "jumpPad" ? 70 + Math.random() * 45 : 28 + Math.random() * 28;
    scene.tweens.add({
      targets: particle,
      x: effect.x + Math.cos(angle) * distance,
      y: effect.y + Math.sin(angle) * distance,
      alpha: 0,
      scale: 0.2,
      duration: effect.kind === "jumpPad" ? 420 : 260,
      ease: Phaser.Math.Easing.Quadratic.Out,
      onComplete: () => particle.destroy()
    });
  }
}

function courseBoundsAt(y: number) {
  const spawnY = 3950;
  const goalY = 160;
  const climbRatio = Math.max(0, Math.min(1, (spawnY - y) / (spawnY - goalY)));
  const width = 2050 - climbRatio * 1120;
  const center = 1100;
  return {
    left: center - width / 2,
    right: center + width / 2
  };
}

function activePlatforms(mode: RoomState["mode"], preset: StagePreset): PlatformView[] {
  const base: PlatformView[] = [
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
    { x: 760, y: 2380, w: 310, h: 24, kind: "stretch", minW: 150, maxW: 420, periodMs: 3600, phaseMs: 400 },
    { x: 520, y: 2100, w: 290, h: 24, kind: "jumpPad" },
    { x: 1130, y: 2100, w: 300, h: 24 },
    { x: 860, y: 1820, w: 290, h: 24 },
    { x: 1220, y: 1540, w: 270, h: 24 },
    { x: 750, y: 1540, w: 270, h: 24 },
    { x: 1000, y: 1260, w: 260, h: 24, kind: "jumpPad" },
    { x: 780, y: 980, w: 240, h: 24, kind: "stretch", minW: 120, maxW: 340, periodMs: 3000, phaseMs: 1200 },
    { x: 1160, y: 980, w: 240, h: 24 },
    { x: 940, y: 700, w: 240, h: 24, kind: "jumpPad" },
    { x: 980, y: 420, w: 260, h: 24 }
  ];
  const presets: Record<StagePreset, { base: PlatformView[]; team: PlatformView[] }> = {
    balanced: {
      base,
      team: [
        { x: 875, y: 1720, w: 450, h: 28, kind: "teamJumpPad" },
        { x: 990, y: 1120, w: 300, h: 28 },
        { x: 1015, y: 840, w: 250, h: 24 }
      ]
    },
    boost: {
      base: base.map((platform) => [3500, 2940, 2380, 1540].includes(platform.y) ? { ...platform, kind: "jumpPad" } : platform),
      team: [
        { x: 850, y: 1720, w: 500, h: 28, kind: "teamJumpPad" },
        { x: 1030, y: 1160, w: 280, h: 24, kind: "jumpPad" },
        { x: 1015, y: 840, w: 250, h: 24 }
      ]
    },
    stretch: {
      base: base.map((platform) => {
        if ([3780, 2940, 2100, 1540, 700].includes(platform.y)) {
          return { ...platform, kind: "stretch", minW: Math.max(110, platform.w * 0.42), maxW: platform.w * 1.28, periodMs: 2800 + platform.y, phaseMs: platform.x };
        }
        return platform;
      }),
      team: [
        { x: 875, y: 1720, w: 450, h: 28, kind: "teamJumpPad" },
        { x: 990, y: 1120, w: 300, h: 28 },
        { x: 1015, y: 840, w: 250, h: 24 }
      ]
    },
    teamwork: {
      base: base.filter((platform) => ![1820, 1540, 1260, 980].includes(platform.y)),
      team: [
        { x: 820, y: 1760, w: 520, h: 28, kind: "teamJumpPad" },
        { x: 980, y: 1220, w: 310, h: 28, kind: "teamJumpPad" },
        { x: 1020, y: 860, w: 240, h: 24 },
        { x: 940, y: 600, w: 280, h: 24, kind: "stretch", minW: 130, maxW: 360, periodMs: 3200 }
      ]
    }
  };
  const selected = presets[preset] ?? presets.balanced;
  if (mode !== "team") return selected.base;
  const teamPlatforms: PlatformView[] = selected.team;
  return [
    ...selected.base.filter((platform) => platform.y !== 1820 && platform.y !== 1540 && platform.y !== 1260),
    ...teamPlatforms
  ].sort((a, b) => b.y - a.y);
}

function currentPlatform(platform: PlatformView): PlatformView {
  if (platform.kind !== "stretch") return platform;
  const minW = platform.minW ?? platform.w;
  const maxW = platform.maxW ?? platform.w;
  const periodMs = platform.periodMs ?? 3200;
  const phaseMs = platform.phaseMs ?? 0;
  const t = ((Date.now() + phaseMs) % periodMs) / periodMs;
  const eased = (1 - Math.cos(t * Math.PI * 2)) / 2;
  const w = minW + (maxW - minW) * eased;
  return {
    ...platform,
    x: platform.x + platform.w / 2 - w / 2,
    w
  };
}

function updateStretchBars(stretchBars: Array<{ platform: PlatformView; body: import("phaser").GameObjects.Rectangle; cap: import("phaser").GameObjects.Rectangle }>) {
  for (const bar of stretchBars) {
    const current = currentPlatform(bar.platform);
    const centerX = current.x + current.w / 2;
    const centerY = current.y + current.h / 2;
    bar.body.setPosition(centerX, centerY);
    bar.body.setSize(current.w, current.h);
    bar.body.scaleX = 1;
    bar.cap.setPosition(centerX, centerY);
    bar.cap.setSize(Math.max(20, current.w - 34), 6);
    bar.cap.scaleX = 1;
  }
}
