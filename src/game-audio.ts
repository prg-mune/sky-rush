export type GameSound = "countdown" | "start" | "jump" | "land" | "goal" | "result";

const AUDIO_STORAGE_KEY = "sky-rush-sound-enabled";
let audioContext: AudioContext | null = null;
let enabled = true;
let preferenceLoaded = false;

export function loadGameAudioPreference() {
  if (typeof window === "undefined") return true;
  if (!preferenceLoaded) {
    enabled = window.localStorage.getItem(AUDIO_STORAGE_KEY) !== "false";
    preferenceLoaded = true;
  }
  return enabled;
}

export function setGameAudioEnabled(nextEnabled: boolean) {
  enabled = nextEnabled;
  preferenceLoaded = true;
  if (typeof window !== "undefined") window.localStorage.setItem(AUDIO_STORAGE_KEY, String(nextEnabled));
  if (nextEnabled) void unlockGameAudio();
}

export async function unlockGameAudio() {
  if (typeof window === "undefined" || !loadGameAudioPreference()) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext ??= new AudioContextClass();
  if (audioContext.state === "suspended") await audioContext.resume();
}

export function playGameSound(sound: GameSound) {
  if (!loadGameAudioPreference()) return;
  void unlockGameAudio().then(() => {
    if (!audioContext || audioContext.state !== "running") return;
    const now = audioContext.currentTime;
    if (sound === "countdown") {
      tone(440, 430, 0.1, now, "square", 0.07);
      tone(660, 640, 0.06, now + 0.025, "sine", 0.045);
    } else if (sound === "start") {
      tone(523.25, 783.99, 0.2, now, "triangle", 0.13);
      tone(783.99, 1046.5, 0.19, now + 0.1, "sine", 0.1);
    } else if (sound === "jump") {
      tone(260, 520, 0.13, now, "sine", 0.12);
      tone(520, 650, 0.07, now + 0.06, "triangle", 0.06);
    } else if (sound === "land") {
      tone(125, 72, 0.11, now, "triangle", 0.13);
      tone(72, 55, 0.08, now + 0.025, "sine", 0.07);
    } else if (sound === "goal") {
      arpeggio([523.25, 659.25, 783.99, 1046.5], now, 0.105, 0.19);
    } else {
      arpeggio([392, 523.25, 659.25, 783.99, 1046.5], now, 0.12, 0.16);
      tone(261.63, 261.63, 0.65, now + 0.48, "triangle", 0.08);
    }
  });
}

function arpeggio(frequencies: number[], startAt: number, interval: number, gain: number) {
  frequencies.forEach((frequency, index) => {
    tone(frequency, frequency * 1.01, interval * 1.7, startAt + index * interval, "triangle", gain);
  });
}

function tone(
  startFrequency: number,
  endFrequency: number,
  duration: number,
  startAt: number,
  type: OscillatorType,
  volume: number
) {
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(startFrequency, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), startAt + duration);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
