import { readGuidance } from "./storage";

let audio: AudioContext | undefined;

// Called only from a gesture. Ambient audio keeps iPhone's silent-switch behavior;
// never use a media playback session or a silent audio loop to bypass restrictions.
export function unlockRestAudio() {
  if (!readGuidance().sound) return;
  try {
    const session = (
      navigator as Navigator & {
        audioSession?: { type: string };
      }
    ).audioSession;
    if (session) session.type = "ambient";
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume().catch(() => {});
  } catch {
    // Unsupported or blocked audio leaves the visual rest notice available.
  }
}

export function playRestCue(kind: "complete" | "skip") {
  if (!readGuidance().sound || !audio || audio.state !== "running") return;
  try {
    const notes =
      kind === "complete"
        ? [
            [0, 523.25, 0.22, 0.17],
            [0.27, 659.25, 0.32, 0.17],
          ]
        : [[0, 440, 0.1, 0.08]];
    for (const [offset, frequency, duration, volume] of notes) {
      const oscillator = audio.createOscillator(),
        gain = audio.createGain();
      const start = audio.currentTime + offset;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(start + duration);
    }
  } catch {
    // Recording and rest completion never depend on audio playback.
  }
}
