# Sound Notifications Setup

This guide explains how to add sound effects to your real-time notification system.

## Audio Files Required

Add these MP3 files to your `public/` directory:

### 1. `notification.mp3` (Default sound)
- **Purpose**: General notifications (appointments, system messages)
- **Recommended**: Gentle, pleasant notification sound
- **Duration**: 1-2 seconds
- **Volume**: Medium

### 2. `alert.mp3` (Alert sound)
- **Purpose**: Critical alerts (low stock, out of stock)
- **Recommended**: More urgent, attention-grabbing sound
- **Duration**: 1-2 seconds
- **Volume**: Medium-high

### 3. `success.mp3` (Success sound)
- **Purpose**: Positive events (new clients, confirmations)
- **Recommended**: Pleasant, positive confirmation sound
- **Duration**: 1-2 seconds
- **Volume**: Medium

## Finding Sound Files

### Free Resources:
1. **Freesound.org** - Search for "notification", "alert", "success"
2. **Zapsplat.com** - Professional sound effects (free with attribution)
3. **YouTube Audio Library** - Free sounds for creators
4. **Notification Sounds** - Search for "UI sound effects"

### Recommended Sounds:
- **Default**: Soft bell, gentle chime, or subtle ping
- **Alert**: More prominent beep or warning tone
- **Success**: Pleasant "ding" or positive affirmation sound

## Sound Settings

Users can control sound notifications through the notification bell:

1. Click the bell icon in the header
2. Click the settings (⚙️) icon
3. Toggle "Sound Notifications" on/off
4. Adjust volume slider (0-100%)
5. Click "Test Sound" to preview

## Technical Details

### Audio Manager Features:
- **Web Audio API** support for better performance
- **Volume control** (0.0 to 1.0)
- **Sound preloading** for instant playback
- **Error handling** for missing files
- **Graceful fallback** if audio isn't supported

### Sound Types by Notification:
- **Appointments**: Default sound
- **Inventory alerts**: Alert sound (more urgent)
- **New clients**: Success sound (positive)
- **System messages**: Default sound

## Browser Compatibility

### Supported Browsers:
- ✅ Chrome 66+
- ✅ Firefox 60+
- ✅ Safari 11.1+
- ✅ Edge 79+

### Audio Playback Requirements:
- HTTPS connection (required for audio on most browsers)
- User interaction (audio can only play after user interaction)
- Audio files must be accessible

## Troubleshooting

### Sounds Not Playing:
1. **Check file paths**: Files must be in `public/` directory
2. **HTTPS required**: Audio only works on secure connections
3. **User interaction**: Audio requires user interaction first
4. **File format**: Must be MP3 format
5. **Browser permissions**: Check if audio is blocked

### Poor Sound Quality:
1. **File compression**: Use 128kbps MP3 for balance of size/quality
2. **File size**: Keep under 100KB per sound file
3. **Sample rate**: 44.1kHz recommended

### Performance Issues:
1. **Preloading**: Sounds are preloaded on initialization
2. **Multiple instances**: Only one instance of each sound plays at a time
3. **Memory usage**: Small MP3 files minimize memory footprint

## Customization

### Adding New Sound Types:
1. Add sound file to `public/`
2. Update `notificationSounds` in `audioManager.ts`
3. Update `getSoundTypeForNotification()` in `notificationStore.ts`

### Custom Sound Logic:
```typescript
// In notificationStore.ts
function getSoundTypeForNotification(type: string): SoundType {
  switch (type) {
    case 'urgent_appointment':
      return 'alert';
    case 'new_client':
      return 'success';
    default:
      return 'default';
  }
}
```

## Best Practices

1. **Keep sounds short** (1-2 seconds maximum)
2. **Use consistent volume** across all sound files
3. **Test on multiple devices** (desktop, mobile, different browsers)
4. **Provide user control** (enable/disable, volume control)
5. **Respect user preferences** (don't play if disabled)
6. **Handle errors gracefully** (fallback to silent notifications)

## Legal Considerations

- **Copyright**: Use royalty-free sounds or create your own
- **Attribution**: If using sounds from free libraries, check attribution requirements
- **Licensing**: Ensure sounds are licensed for commercial use if applicable