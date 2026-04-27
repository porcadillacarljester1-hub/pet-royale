// Notification sounds - paths to files in public directory
const notificationSounds = {
  default: "/notification.mp3",
  alert: "/alert.mp3",
  success: "/success.mp3",
};

export type SoundType = keyof typeof notificationSounds;

class AudioManager {
  private audioContext: AudioContext | null = null;
  private sounds: Map<string, HTMLAudioElement> = new Map();
  private enabled: boolean = true;
  private volume: number = 0.5;

  constructor() {
    this.initAudioContext();
    this.preloadSounds();
  }

  private initAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
      console.warn('Web Audio API not supported');
    }
  }

  private preloadSounds() {
    Object.entries(notificationSounds).forEach(([key, src]) => {
      const audio = new Audio(src);
      audio.preload = 'auto';
      audio.volume = this.volume;
      this.sounds.set(key, audio);
    });
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.sounds.forEach(audio => {
      audio.volume = this.volume;
    });
  }

  play(soundType: SoundType = 'default') {
    if (!this.enabled) return;

    const audio = this.sounds.get(soundType);
    if (audio) {
      // Reset audio to beginning in case it's already playing
      audio.currentTime = 0;
      audio.play().catch(e => {
        console.warn('Could not play notification sound:', e);
      });
    }
  }

  playCustom(url: string) {
    if (!this.enabled) return;

    const audio = new Audio(url);
    audio.volume = this.volume;
    audio.play().catch(e => {
      console.warn('Could not play custom sound:', e);
    });
  }
}

export const audioManager = new AudioManager();