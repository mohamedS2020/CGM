# Alarm Sound Troubleshooting Guide

## Sound Files Locations

The alarm sound has been added to:
- `assets/sounds/alarm.mp3` - General app usage
- `android/app/src/main/res/raw/alarm.mp3` - Android-specific implementation

## Troubleshooting Steps

### If the alarm doesn't play on Android:

1. **Check sound file exists**: Verify that `alarm.mp3` exists in `android/app/src/main/res/raw/` directory.

2. **Check permissions**: Make sure your app has the appropriate permissions in `AndroidManifest.xml`:
   ```xml
   <uses-permission android:name="android.permission.VIBRATE" />
   ```

3. **Check volume**: Ensure device volume is not muted and media volume is turned up.

4. **Rebuild the app**: After adding sound files, run:
   ```bash
   npm run android
   ```

5. **Test with a simple sound**: If the alarm still doesn't work, try testing with a simpler sound file.

### If the alarm doesn't play on iOS:

1. **Check Xcode project**: Make sure `alarm.mp3` is included in your Xcode project:
   - Open Xcode
   - Navigate to your project
   - Verify `alarm.mp3` is in the project navigator
   - Check that the file is included in your target's "Build Phases" > "Copy Bundle Resources"

2. **Check silent mode**: iOS devices in silent mode might not play sounds. Check if your device is in silent mode.

3. **Rebuild the app**: After adding sound files, run:
   ```bash
   npm run ios
   ```

## Alternative Solutions

If you continue to have issues with `react-native-sound`, consider these alternatives:

1. **Use Expo Audio**: If your project uses Expo, consider using `expo-av`:
   ```javascript
   import { Audio } from 'expo-av';
   
   const playSound = async () => {
     const { sound } = await Audio.Sound.createAsync(
       require('../assets/sounds/alarm.mp3')
     );
     await sound.playAsync();
   };
   ```

2. **Use React Native's built-in Sound API**: 
   ```javascript
   import { Sound } from 'react-native';
   
   const sound = new Sound('alarm.mp3');
   sound.play();
   ```

## Testing the Alarm

To test if the alarm works:

1. Manually enter a glucose reading above 180 mg/dL or below 70 mg/dL
2. The alert should appear with sound and vibration
3. If only the alert appears without sound, check the troubleshooting steps above 