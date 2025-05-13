# Alarm Sound for Glucose Alerts

## Adding the Alarm Sound File

To enable sound alerts for high/low glucose readings, you need to add an MP3 file named `alarm.mp3` to this directory. Follow these steps:

1. Find a suitable alarm sound (an MP3 file with clear, attention-grabbing sound).
2. Rename the file to `alarm.mp3`.
3. Place the file in this directory (`assets/sounds/`).

## Additional Setup for Android

For Android, you'll also need to copy the `alarm.mp3` file to the raw resources directory:

1. Copy `alarm.mp3` to `android/app/src/main/res/raw/` (create the 'raw' directory if it doesn't exist).

## Additional Setup for iOS

For iOS, the sound file needs to be added to the Xcode project:

1. Open the iOS project in Xcode.
2. Drag `alarm.mp3` into the project navigator.
3. Make sure to check "Copy items if needed" and select your app's target.

## Testing

Once you've added the sound file, restart your development environment and test the alert functionality by:

1. Manually entering a glucose reading above 180 mg/dL or below 70 mg/dL, or
2. Scanning a sensor that returns values outside the normal range.

## Troubleshooting

If the alarm doesn't play:

- Check that the sound file is named exactly `alarm.mp3`.
- Verify that the file is in the correct locations for your platform.
- Ensure your device's volume is turned up and it's not in silent mode.
- For iOS, make sure the app has permission to play sounds. 