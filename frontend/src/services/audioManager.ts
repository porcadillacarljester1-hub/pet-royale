// Path: frontend/src/services/audioManager.ts

const notificationSounds = {
  default: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',
  alert: 'https://assets.mixkit.co/active_storage/sfx/2870/2870-preview.mp3',
  success: 'https://assets.mixkit.co/active_storage/sfx/2868/2868-preview.mp3',
};

export type SoundType = keyof typeof notificationSounds;

class AudioManager {
  private enabled: boolean = true;
  private volume: number = 0.5;
  private audioContext: AudioContext | null = null;

  constructor() {
    // Initialize AudioContext on first user interaction
    if (typeof window !== 'undefined') {
      document.addEventListener('click', () => this.initAudioContext(), { once: true });
      document.addEventListener('keydown', () => this.initAudioContext(), { once: true });
    }
  }

  private initAudioContext() {
    if (!this.audioContext && typeof window !== 'undefined') {
      try {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (e) {
        console.warn('Could not initialize AudioContext:', e);
      }
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  play(soundType: SoundType = 'default') {
    if (!this.enabled) return;

    // Try to play audio file first
    const soundPath = notificationSounds[soundType];
    this.playAudioFile(soundPath, soundType);
  }

  private playAudioFile(path: string, soundType: SoundType = 'default') {
    try {
      const audio = new Audio(path);
      audio.volume = this.volume;
      audio.play().catch((e) => {
        console.warn(`Could not play audio ${path}:`, e);
        // Fallback to synthesized tone if file fails
        this.playTone(soundType);
      });
    } catch (e) {
      console.warn('Could not create audio element:', e);
    }
  }

  private playTone(soundType: SoundType = 'default') {
    if (!this.enabled) return;

    try {
      this.initAudioContext();
      if (!this.audioContext) return;

      const frequencies = {
        default: 880,   // A5
        alert: 440,     // A4 (lower, more urgent)
        success: 1046,  // C6 (higher, positive)
      };

      const ctx = this.audioContext;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = frequencies[soundType];
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(this.volume * 0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.warn('Could not play tone:', e);
    }
  }

  playCustom(url: string) {
    if (!this.enabled) return;

    try {
      const audio = new Audio(url);
      audio.volume = this.volume;
      audio.play().catch((e) => {
        console.warn('Could not play custom sound:', e);
      });
    } catch (e) {
      console.warn('Could not create audio element:', e);
    }
  }
}

export const audioManager = new AudioManager();