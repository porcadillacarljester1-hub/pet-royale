const notificationSounds = {
  default: 880,   // A5
  alert: 440,     // A4 (lower, more urgent)
  success: 1046,  // C6 (higher, positive)
};

export type SoundType = keyof typeof notificationSounds;

class AudioManager {
  private enabled: boolean = true;
  private volume: number = 0.5;

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  play(soundType: SoundType = 'default') {
    if (!this.enabled) return;

    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = notificationSounds[soundType];
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(this.volume * 0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.warn('Could not play sound:', e);
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