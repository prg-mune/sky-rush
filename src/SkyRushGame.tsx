import { useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import type { ClientInput, ClientToServerEvents, EffectBurst, RoomState, ServerToClientEvents, StageId } from "../shared/types";
import { currentPlatform as resolvePlatform, stageMetrics, stagePlatforms, type Platform } from "../shared/stage-layout";

type Props = {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  room: RoomState;
  spectatingPlayerId?: string;
};

type PlatformView = Platform & {
  visibility?: number;
};

type PlayerMotionFx = {
  previousVy: number;
  previousJumping: boolean;
  launchAt?: number;
  landAt?: number;
  pushAt?: number;
  pushDirection: -1 | 1;
};

export default function SkyRushGame({ socket, room, spectatingPlayerId }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const roomRef = useRef(room);
  const spectatingPlayerIdRef = useRef(spectatingPlayerId);
  const serverClockOffsetRef = useRef(0);
  roomRef.current = room;
  spectatingPlayerIdRef.current = spectatingPlayerId;
  serverClockOffsetRef.current = room.serverTime - Date.now();

  useEffect(() => {
    let game: import("phaser").Game | null = null;
    let destroyed = false;

    async function boot() {
      const Phaser = await import("phaser");
      if (!hostRef.current || destroyed) return;

      const playerSprites = new Map<string, Phaser.GameObjects.Group>();
      const nameLabels = new Map<string, Phaser.GameObjects.Text>();
      const playerMotionFx = new Map<string, PlayerMotionFx>();
      const animatedPlatforms: Array<{ platform: PlatformView; body: Phaser.GameObjects.Rectangle; cap?: Phaser.GameObjects.Rectangle }> = [];
      const keys = { left: false, right: false, jump: false };
      const touchInput = { pointerId: -1, startX: 0 };
      let activeScene: Phaser.Scene | null = null;
      let jumpStarted = 0;
      let jumpHeldMs = 0;
      let chargeStartedOnGround = false;
      let jumpRequestId = 0;
      let lastSentAt = 0;
      let lastSentSignature = "";
      let lastSentJumpRequestId = 0;
      let seq = 0;

      class MainScene extends Phaser.Scene {
        private cameraTarget?: Phaser.GameObjects.Rectangle;
        private chargeGauge?: Phaser.GameObjects.Graphics;
        private chargeMaxLabel?: Phaser.GameObjects.Text;

        create() {
          const metrics = stageMetrics(roomRef.current.stageId);
          const worldHeight = metrics.spawnY + 350;
          activeScene = this;
          this.cameras.main.setBounds(0, 0, 2200, worldHeight);
          this.world();
          this.cameraTarget = this.add.rectangle(1100, metrics.spawnY, 1, 1).setVisible(false);
          this.cameras.main.startFollow(this.cameraTarget, true, 0.12, 0.16);
          this.chargeGauge = this.add.graphics().setDepth(120);
          this.chargeMaxLabel = this.add.text(0, 0, "MAX", {
            fontFamily: "Arial",
            fontSize: "10px",
            color: "#fff6bf",
            stroke: "#102538",
            strokeThickness: 3,
            fontStyle: "bold"
          }).setOrigin(0.5).setDepth(121).setVisible(false);
          window.addEventListener("keydown", onKeyDown);
          window.addEventListener("keyup", onKeyUp);
          hostRef.current?.addEventListener("pointerdown", onPointerDown);
          hostRef.current?.addEventListener("pointermove", onPointerMove);
          hostRef.current?.addEventListener("pointerup", onPointerUp);
          hostRef.current?.addEventListener("pointercancel", onPointerUp);
        }

        update() {
          const frameNow = Date.now();
          const serverNow = frameNow + serverClockOffsetRef.current;
          const me = roomRef.current.players.find((player) => player.id === socket.id);
          if (keys.jump && me) {
            if (me.grounded && !chargeStartedOnGround) {
              jumpStarted = performance.now();
              jumpHeldMs = 0;
              chargeStartedOnGround = true;
            } else if (!me.grounded && chargeStartedOnGround) {
              chargeStartedOnGround = false;
              jumpHeldMs = 0;
            }
          }
          const chargeRatio = currentChargeRatio();
          const cameraPlayer = roomRef.current.players.find((player) => player.id === spectatingPlayerIdRef.current) ?? me;
          if (cameraPlayer && this.cameraTarget) this.cameraTarget.setPosition(cameraPlayer.x, cameraPlayer.y);
          syncSprites(this, Phaser, playerSprites, nameLabels, playerMotionFx, roomRef.current, socket.id, chargeRatio, frameNow);
          updateChargeGauge(
            this.chargeGauge,
            this.chargeMaxLabel,
            me,
            chargeRatio,
            serverNow,
            roomRef.current.startedAt
          );
          updateAnimatedPlatforms(animatedPlatforms, serverNow);
          sendInput(performance.now());
        }

        destroy() {
          activeScene = null;
          window.removeEventListener("keydown", onKeyDown);
          window.removeEventListener("keyup", onKeyUp);
          hostRef.current?.removeEventListener("pointerdown", onPointerDown);
          hostRef.current?.removeEventListener("pointermove", onPointerMove);
          hostRef.current?.removeEventListener("pointerup", onPointerUp);
          hostRef.current?.removeEventListener("pointercancel", onPointerUp);
        }

        private world() {
          const metrics = stageMetrics(roomRef.current.stageId);
          const worldHeight = metrics.spawnY + 350;
          this.add.rectangle(1100, worldHeight / 2, 2200, worldHeight, 0x102538);
          for (let y = 0; y < worldHeight; y += 220) {
            this.add.line(0, y, 0, 0, 2200, 0, 0x203f5a, 0.45);
          }
          this.add.rectangle(1100, metrics.goalY, 440, 42, 0xf5d76e);
          this.add.text(992, metrics.goalY - 26, "GOAL", { fontFamily: "Arial", fontSize: "28px", color: "#17202a", fontStyle: "bold" });
          activePlatforms(roomRef.current.mode, roomRef.current.stageId).forEach((platform, index) => {
            const isStretch = platform.kind === "stretch";
            const isVanish = platform.kind === "vanish";
            const color = isStretch ? 0xf783ac : isVanish ? 0xb197fc : index % 3 === 1 ? 0x74c69d : index % 3 === 2 ? 0x89cff0 : 0xe9c46a;
            const body = this.add.rectangle(platform.x + platform.w / 2, platform.y + platform.h / 2, platform.w, platform.h, color).setStrokeStyle(2, isStretch ? 0xffdeeb : isVanish ? 0xe5dbff : 0xffffff, 0.7);
            if (isStretch) {
              const cap = this.add.rectangle(platform.x + platform.w / 2, platform.y + platform.h / 2, Math.max(20, platform.w - 34), 6, 0xffdeeb, 0.75);
              animatedPlatforms.push({ platform, body, cap });
            }
            if (isVanish) {
              const cap = this.add.rectangle(platform.x + platform.w / 2, platform.y + 5, Math.max(28, platform.w - 28), 5, 0xe5dbff, 0.82);
              animatedPlatforms.push({ platform, body, cap });
            }
          });
          if (roomRef.current.stageId === "team_01_skybase") drawTeamAssistZones(this);
          drawCourseBoundary(this, metrics);
        }
      }

      function onKeyDown(event: KeyboardEvent) {
        if (event.code === "KeyA" || event.code === "ArrowLeft") keys.left = true;
        if (event.code === "KeyD" || event.code === "ArrowRight") keys.right = true;
        if (event.code === "Space") {
          beginJumpCharge();
          event.preventDefault();
        }
      }

      function onKeyUp(event: KeyboardEvent) {
        if (event.code === "KeyA" || event.code === "ArrowLeft") keys.left = false;
        if (event.code === "KeyD" || event.code === "ArrowRight") keys.right = false;
        if (event.code === "Space") {
          finishJumpCharge();
          event.preventDefault();
        }
      }

      function onPointerDown(event: PointerEvent) {
        if (event.pointerType === "mouse" || touchInput.pointerId !== -1) return;
        touchInput.pointerId = event.pointerId;
        touchInput.startX = event.clientX;
        hostRef.current?.setPointerCapture(event.pointerId);
        keys.left = false;
        keys.right = false;
        beginJumpCharge();
        event.preventDefault();
      }

      function onPointerMove(event: PointerEvent) {
        if (event.pointerId !== touchInput.pointerId) return;
        const deltaX = event.clientX - touchInput.startX;
        const deadZone = 22;
        keys.left = deltaX < -deadZone;
        keys.right = deltaX > deadZone;
        event.preventDefault();
      }

      function onPointerUp(event: PointerEvent) {
        if (event.pointerId !== touchInput.pointerId) return;
        finishJumpCharge();
        keys.left = false;
        keys.right = false;
        touchInput.pointerId = -1;
        hostRef.current?.releasePointerCapture(event.pointerId);
        event.preventDefault();
      }

      function finishJumpCharge() {
        if (keys.jump) {
          jumpHeldMs = chargeStartedOnGround ? performance.now() - jumpStarted : 0;
          jumpRequestId += 1;
        }
        keys.jump = false;
        chargeStartedOnGround = false;
      }

      function beginJumpCharge() {
        const serverNow = Date.now() + serverClockOffsetRef.current;
        if (roomRef.current.startedAt && serverNow < roomRef.current.startedAt) return;
        if (!keys.jump) {
          jumpStarted = performance.now();
          const me = roomRef.current.players.find((player) => player.id === socket.id);
          chargeStartedOnGround = Boolean(me?.grounded);
          jumpHeldMs = 0;
        }
        keys.jump = true;
      }

      function currentHeldMs() {
        if (!keys.jump) return jumpHeldMs;
        return chargeStartedOnGround ? performance.now() - jumpStarted : 0;
      }

      function currentInput(seqValue: number): ClientInput {
        return {
          left: keys.left,
          right: keys.right,
          jump: keys.jump,
          jumpHeldMs: currentHeldMs(),
          jumpRequestId,
          seq: seqValue
        };
      }

      function currentChargeRatio() {
        if (!keys.jump || !chargeStartedOnGround) return 0;
        return Math.min(1, Math.max(0, currentHeldMs() / 650));
      }

      function inputSignature() {
        return `${Number(keys.left)}:${Number(keys.right)}:${Number(keys.jump)}:${jumpRequestId}:${Math.round(currentHeldMs() / 50)}`;
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
        if (effect.kind === "push") markPushedPlayers(roomRef.current, playerMotionFx, effect, Date.now());
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
  motionFxByPlayer: Map<string, PlayerMotionFx>,
  room: RoomState,
  localPlayerId: string | undefined,
  localChargeRatio: number,
  now: number
) {
  const active = new Set(room.players.map((player) => player.id));
  for (const player of room.players) {
    let group = groups.get(player.id);
    let label = labels.get(player.id);
    if (!group) {
      group = createPlayerSprite(scene, player);
      label = scene.add.text(0, 0, player.name, {
        fontFamily: "Arial",
        fontSize: "15px",
        color: "#ffffff",
        stroke: "#102538",
        strokeThickness: 4
      });
      groups.set(player.id, group);
      labels.set(player.id, label);
    }
    let motionFx = motionFxByPlayer.get(player.id);
    if (!motionFx) {
      motionFx = { previousVy: player.vy, previousJumping: player.jumping, pushDirection: 1 };
      motionFxByPlayer.set(player.id, motionFx);
    }
    if (player.jumping && !motionFx.previousJumping && player.vy < 0) motionFx.launchAt = now;
    if (motionFx.previousVy > 120 && Math.abs(player.vy) < 1 && !player.jumping) motionFx.landAt = now;
    motionFx.previousVy = player.vy;
    motionFx.previousJumping = player.jumping;

    const chargeRatio = player.id === localPlayerId && !player.jumping ? localChargeRatio : 0;
    updatePlayerSprite(group, player, motionFx, chargeRatio, now);
    label?.setPosition(player.x - 18, player.y - 34).setAlpha(player.connected ? 1 : 0.35);
  }
  for (const [id, group] of groups) {
    if (!active.has(id)) {
      group.destroy(true);
      groups.delete(id);
      labels.get(id)?.destroy();
      labels.delete(id);
      motionFxByPlayer.delete(id);
    }
  }
}

function markPushedPlayers(
  room: RoomState,
  motionFxByPlayer: Map<string, PlayerMotionFx>,
  effect: EffectBurst,
  now: number
) {
  const nearby = room.players
    .filter((player) => player.connected && !player.finishedAt)
    .map((player) => {
      const centerX = player.x + 17;
      const centerY = player.y + 23;
      return { player, centerX, distance: Math.hypot(centerX - effect.x, centerY - effect.y) };
    })
    .filter((entry) => entry.distance < 90)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 2);

  for (const entry of nearby) {
    const current = motionFxByPlayer.get(entry.player.id) ?? {
      previousVy: entry.player.vy,
      previousJumping: entry.player.jumping,
      pushDirection: 1 as const
    };
    current.pushAt = now;
    current.pushDirection = entry.centerX < effect.x ? -1 : 1;
    motionFxByPlayer.set(entry.player.id, current);
  }
}

function updateChargeGauge(
  gauge: import("phaser").GameObjects.Graphics | undefined,
  maxLabel: import("phaser").GameObjects.Text | undefined,
  player: RoomState["players"][number] | undefined,
  ratio: number,
  serverNow: number,
  startedAt?: number
) {
  if (!gauge || !maxLabel) return;
  gauge.clear();

  const canCharge = Boolean(
    player &&
    player.connected &&
    !player.finishedAt &&
    !player.jumping &&
    (!startedAt || serverNow >= startedAt) &&
    ratio > 0
  );
  if (!canCharge || !player) {
    gauge.setVisible(false);
    maxLabel.setVisible(false);
    return;
  }

  const centerX = player.x + 17;
  const gaugeY = player.y + 53;
  const gaugeWidth = 48;
  const fillWidth = Math.max(4, gaugeWidth * ratio);
  const isMax = ratio >= 1;
  const fillColor = isMax ? 0xffd166 : ratio >= 0.55 ? 0xa9e66e : 0x68d8f0;

  gauge.setVisible(true);
  gauge.fillStyle(0x061522, 0.78);
  gauge.fillRoundedRect(centerX - gaugeWidth / 2 - 2, gaugeY - 2, gaugeWidth + 4, 10, 5);
  gauge.fillStyle(fillColor, 1);
  gauge.fillRoundedRect(centerX - gaugeWidth / 2, gaugeY, fillWidth, 6, 3);

  if (isMax) {
    const pulse = 0.58 + Math.sin(serverNow / 85) * 0.2;
    gauge.lineStyle(3, 0xffe69a, pulse);
    gauge.strokeCircle(centerX, player.y + 28, 27 + Math.sin(serverNow / 110) * 2);
    maxLabel.setPosition(centerX, player.y + 62).setVisible(true).setAlpha(0.82 + Math.sin(serverNow / 90) * 0.18);
  } else {
    maxLabel.setVisible(false);
  }
}

function createPlayerSprite(scene: import("phaser").Scene, player: RoomState["players"][number]) {
  const bodyColor = playerColor(player);
  const bibColor = 0xf8fbff;
  const objects = [
    scene.add.ellipse(0, 0, 40, 12, 0x061522, 0.36).setName("shadow"),
    scene.add.ellipse(0, 0, 38, 34, bodyColor).setStrokeStyle(3, 0xffffff, 0.95).setName("body"),
    scene.add.circle(0, 0, 8, shadeColor(bodyColor, 0.18), 0.85).setName("topBlob"),
    scene.add.ellipse(0, 0, 18, 8, 0xffffff, 0.42).setName("shine"),
    scene.add.circle(0, 0, 5, 0x102538).setName("leftEye"),
    scene.add.circle(0, 0, 5, 0x102538).setName("rightEye"),
    scene.add.circle(0, 0, 2, 0xffffff).setName("leftEyeSpark"),
    scene.add.circle(0, 0, 2, 0xffffff).setName("rightEyeSpark"),
    scene.add.ellipse(0, 0, 6, 4, 0xff9fb0, 0.68).setName("leftCheek"),
    scene.add.ellipse(0, 0, 6, 4, 0xff9fb0, 0.68).setName("rightCheek"),
    scene.add.arc(0, 0, 7, 20, 160, false).setStrokeStyle(2.5, 0x102538).setName("mouth"),
    scene.add.ellipse(0, 0, 7, 9, 0x102538).setName("mouthOpen").setVisible(false),
    scene.add.rectangle(0, 0, 15, 10, bibColor, 0.96).setStrokeStyle(1, 0x102538, 0.45).setName("bib")
  ];
  const number = scene.add.text(0, 0, player.isCpu ? "AI" : player.team ? `T${player.team}` : "SR", {
    fontFamily: "Arial",
    fontSize: "6px",
    color: "#102538",
    fontStyle: "bold"
  }).setName("bibNumber");
  return scene.add.group([...objects, number]);
}

function updatePlayerSprite(
  group: import("phaser").GameObjects.Group,
  player: RoomState["players"][number],
  motionFx: PlayerMotionFx,
  chargeRatio: number,
  now: number
) {
  const centerX = player.x + 17;
  const centerY = player.y + 23;
  const faceDir = player.facing === "right" ? 1 : -1;
  const isFalling = player.jumping && player.vy > 150;
  const isRising = player.jumping && player.vy < -80;
  const launchStrength = motionFx.launchAt ? Math.max(0, 1 - (now - motionFx.launchAt) / 220) : 0;
  const landStrength = motionFx.landAt ? Math.max(0, 1 - (now - motionFx.landAt) / 190) : 0;
  const pushStrength = motionFx.pushAt ? Math.max(0, 1 - (now - motionFx.pushAt) / 230) : 0;
  const idleBob = !player.jumping && chargeRatio === 0 && landStrength === 0 ? Math.sin(now / 180 + player.id.length) * 0.8 : 0;

  let squashX = player.jumping ? 0.94 : 1;
  let squashY = player.jumping ? 1.11 : 1;
  let bodyAngle = 0;
  let bodyOffsetY = idleBob;
  if (isRising) {
    squashX = 0.91 - launchStrength * 0.09;
    squashY = 1.16 + launchStrength * 0.2;
  }
  if (chargeRatio > 0) {
    squashX = 1 + chargeRatio * 0.2;
    squashY = 1 - chargeRatio * 0.17;
    bodyOffsetY = chargeRatio * 3;
  }
  if (landStrength > 0) {
    squashX = 1 + landStrength * 0.24;
    squashY = 1 - landStrength * 0.2;
    bodyOffsetY = landStrength * 4;
  }
  if (pushStrength > 0) {
    squashX = 1 + pushStrength * 0.26;
    squashY = 1 - pushStrength * 0.12;
    bodyAngle = motionFx.pushDirection * pushStrength * 9;
  }

  const focused = chargeRatio > 0.12;
  const eyeScaleY = focused ? Math.max(0.38, 1 - chargeRatio * 0.62) : isFalling ? 1.24 : 1;
  const eyeScaleX = isFalling ? 1.12 : 1;
  const faceOffsetX = pushStrength * motionFx.pushDirection * 3;
  const bob = player.jumping ? -3 : bodyOffsetY;
  const verticalStretch = Math.max(0, squashY - 1);
  const positions: Record<string, { x: number; y: number; angle?: number; scaleX?: number; scaleY?: number }> = {
    shadow: { x: centerX, y: player.y + 47, scaleX: player.jumping ? 0.78 : 1, scaleY: 1 },
    body: { x: centerX, y: centerY + 5 + bob, angle: bodyAngle, scaleX: squashX, scaleY: squashY },
    topBlob: { x: centerX - 7 * faceDir, y: centerY - 12 + bob - verticalStretch * 8, scaleX: squashX, scaleY: squashY },
    shine: { x: centerX - 8 * faceDir, y: centerY - 4 + bob - verticalStretch * 4, angle: -18 * faceDir },
    leftEye: { x: centerX - 8 + 2 * faceDir + faceOffsetX, y: centerY + bob - verticalStretch * 2, scaleX: eyeScaleX, scaleY: eyeScaleY },
    rightEye: { x: centerX + 8 + 2 * faceDir + faceOffsetX, y: centerY + bob - verticalStretch * 2, scaleX: eyeScaleX, scaleY: eyeScaleY },
    leftEyeSpark: { x: centerX - 6 + 2 * faceDir + faceOffsetX, y: centerY - 2 + bob - verticalStretch * 2, scaleY: focused ? 0.45 : 1 },
    rightEyeSpark: { x: centerX + 10 + 2 * faceDir + faceOffsetX, y: centerY - 2 + bob - verticalStretch * 2, scaleY: focused ? 0.45 : 1 },
    leftCheek: { x: centerX - 13 + faceDir + faceOffsetX, y: centerY + 8 + bob + verticalStretch * 2 },
    rightCheek: { x: centerX + 13 + faceDir + faceOffsetX, y: centerY + 8 + bob + verticalStretch * 2 },
    mouth: { x: centerX + 1 * faceDir + faceOffsetX, y: centerY + 7 + bob + verticalStretch * 3, scaleX: focused ? 0.72 : 1, scaleY: landStrength > 0 ? 0.55 : 1 },
    mouthOpen: { x: centerX + 1 * faceDir + faceOffsetX, y: centerY + 8 + bob + verticalStretch * 3, scaleX: 1, scaleY: 1 + Math.min(0.35, player.vy / 1200) },
    bib: { x: centerX, y: centerY + 17 + bob + verticalStretch * 7, angle: player.jumping ? -4 * faceDir : 0 },
    bibNumber: { x: centerX - 5, y: centerY + 13 + bob + verticalStretch * 6, angle: player.jumping ? -4 * faceDir : 0 }
  };
  group.getChildren().forEach((child) => {
    const object = child as import("phaser").GameObjects.GameObject & {
      setPosition: (x: number, y: number) => void;
      setAlpha: (alpha: number) => void;
      setVisible?: (visible: boolean) => void;
      setRotation?: (rotation: number) => void;
      setScale?: (x: number, y?: number) => void;
    };
    const position = positions[object.name];
    if (!position) return;
    object.setPosition(position.x, position.y);
    object.setAlpha(player.connected ? 1 : 0.35);
    if (object.name === "mouth") object.setVisible?.(!isFalling);
    if (object.name === "mouthOpen") object.setVisible?.(isFalling);
    object.setRotation?.(PhaserMathDegToRad(position.angle ?? 0));
    object.setScale?.(position.scaleX ?? 1, position.scaleY ?? position.scaleX ?? 1);
  });
}

function teamColor(team: number) {
  return [0xff6b6b, 0x4dabf7, 0x51cf66, 0xffd43b][team - 1] || 0xda77f2;
}

function playerColor(player: RoomState["players"][number]) {
  if (player.isCpu) return 0x9aa6b2;
  if (player.team) return teamColor(player.team);
  return parseHexColor(player.color) ?? 0xff6b6b;
}

function parseHexColor(color?: string) {
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return undefined;
  return Number.parseInt(color.slice(1), 16);
}

function shadeColor(color: number, amount: number) {
  const adjust = (channel: number) => Math.max(0, Math.min(255, Math.round(channel + channel * amount)));
  const r = adjust((color >> 16) & 255);
  const g = adjust((color >> 8) & 255);
  const b = adjust(color & 255);
  return (r << 16) + (g << 8) + b;
}

function PhaserMathDegToRad(degrees: number) {
  return degrees * (Math.PI / 180);
}

function spawnEffect(scene: import("phaser").Scene, Phaser: typeof import("phaser"), effect: EffectBurst) {
  const color = effect.kind === "jump" ? 0xeaff8f : 0xffffff;
  const count = effect.kind === "jump" ? 12 : 7;
  for (let i = 0; i < count; i += 1) {
    const particle = scene.add.circle(effect.x, effect.y, effect.kind === "jump" ? 5 : 3, color, 0.88);
    const angle = effect.kind === "jump" ? -Math.PI / 2 + (Math.random() - 0.5) * 1.4 : Math.random() * Math.PI * 2;
    const distance = effect.kind === "jump" ? 70 + Math.random() * 45 : 28 + Math.random() * 28;
    scene.tweens.add({
      targets: particle,
      x: effect.x + Math.cos(angle) * distance,
      y: effect.y + Math.sin(angle) * distance,
      alpha: 0,
      scale: 0.2,
      duration: effect.kind === "jump" ? 420 : 260,
      ease: Phaser.Math.Easing.Quadratic.Out,
      onComplete: () => particle.destroy()
    });
  }
}

function courseBoundsAt(y: number, metrics: { spawnY: number; goalY: number }) {
  const climbRatio = Math.max(0, Math.min(1, (metrics.spawnY - y) / (metrics.spawnY - metrics.goalY)));
  const width = 2050 - climbRatio * 1120;
  const center = 1100;
  return {
    left: center - width / 2,
    right: center + width / 2
  };
}

function drawCourseBoundary(scene: import("phaser").Scene, metrics: { spawnY: number; goalY: number }) {
  const yValues: number[] = [];
  for (let y = metrics.goalY; y <= metrics.spawnY + 220; y += 120) yValues.push(y);
  if (yValues[yValues.length - 1] < metrics.spawnY + 220) yValues.push(metrics.spawnY + 220);

  const graphics = scene.add.graphics();
  drawBoundaryPath(graphics, yValues, metrics, "left", 18, 0x253d4d, 0.82);
  drawBoundaryPath(graphics, yValues, metrics, "right", 18, 0x253d4d, 0.82);
  drawBoundaryPath(graphics, yValues, metrics, "left", 8, 0x8ba5b4, 0.9);
  drawBoundaryPath(graphics, yValues, metrics, "right", 8, 0x8ba5b4, 0.9);
}

function drawTeamAssistZones(scene: import("phaser").Scene) {
  [
    { x: 1070, y: 1415, w: 1220, h: 560, label: "TEAM BOOST 1" },
    { x: 1135, y: 660, w: 1040, h: 560, label: "TEAM BOOST 2" }
  ].forEach((zone) => {
    scene.add.rectangle(zone.x, zone.y, zone.w, zone.h, 0x2f4858, 0.28).setStrokeStyle(4, 0xd0ebff, 0.36);
    scene.add.text(zone.x - zone.w / 2 + 24, zone.y - zone.h / 2 + 28, zone.label, {
      fontFamily: "Arial",
      fontSize: "24px",
      color: "#d0ebff",
      stroke: "#102538",
      strokeThickness: 5
    });
  });
}

function drawBoundaryPath(
  graphics: import("phaser").GameObjects.Graphics,
  yValues: number[],
  metrics: { spawnY: number; goalY: number },
  side: "left" | "right",
  width: number,
  color: number,
  alpha: number
) {
  graphics.lineStyle(width, color, alpha);
  graphics.beginPath();
  yValues.forEach((y, index) => {
    const bounds = courseBoundsAt(y, metrics);
    const x = side === "left" ? bounds.left : bounds.right;
    if (index === 0) graphics.moveTo(x, y);
    else graphics.lineTo(x, y);
  });
  graphics.strokePath();
}

function activePlatforms(mode: RoomState["mode"], stageId: StageId): PlatformView[] {
  return stagePlatforms(mode, stageId);
}

function currentPlatform(platform: PlatformView, now: number): PlatformView {
  const resolved = resolvePlatform(platform, now);
  if (platform.kind === "vanish") {
    const visibleMs = platform.visibleMs ?? 2600;
    const hiddenMs = platform.hiddenMs ?? 1200;
    const periodMs = visibleMs + hiddenMs;
    const phaseMs = platform.phaseMs ?? 0;
    const elapsed = (now + phaseMs) % periodMs;
    const fadeWindow = Math.min(450, visibleMs / 3);
    const fadeIn = Math.min(1, elapsed / fadeWindow);
    const fadeOut = Math.min(1, (visibleMs - elapsed) / fadeWindow);
    const active = elapsed < visibleMs;
    const visibility = active ? Math.max(0.18, Math.min(fadeIn, fadeOut)) : 0.12;
    return {
      ...resolved,
      visibility
    };
  }
  return resolved;
}

function updateAnimatedPlatforms(animatedPlatforms: Array<{ platform: PlatformView; body: import("phaser").GameObjects.Rectangle; cap?: import("phaser").GameObjects.Rectangle }>, now: number) {
  for (const bar of animatedPlatforms) {
    const current = currentPlatform(bar.platform, now);
    const centerX = current.x + current.w / 2;
    const centerY = current.y + current.h / 2;
    bar.body.setPosition(centerX, centerY);
    bar.body.setSize(current.w, current.h);
    bar.body.scaleX = 1;
    if (current.kind === "vanish") {
      const alpha = current.visibility ?? 1;
      bar.body.setAlpha(alpha);
      bar.cap?.setAlpha(Math.min(0.9, alpha + 0.14));
      bar.cap?.setPosition(centerX, current.y + 5);
      bar.cap?.setSize(Math.max(28, current.w - 28), 5);
      if (bar.cap) bar.cap.scaleX = 1;
    } else {
      bar.body.setAlpha(1);
      bar.cap?.setAlpha(0.75);
      bar.cap?.setPosition(centerX, centerY);
      bar.cap?.setSize(Math.max(20, current.w - 34), 6);
      if (bar.cap) bar.cap.scaleX = 1;
    }
  }
}
