# Glucose Alert Feature Setup Guide

This guide will help you set up and use the new glucose alert feature in the CGM app, which triggers an alarm when glucose readings are outside the safe range.

## What's Been Added

1. **AlertService** - A new service that monitors glucose readings and triggers alerts for high/low values
2. **AlertModal** - A full-screen modal that displays when an alert is triggered
3. **Alarm Sound** - Audio alert for dangerous glucose levels
4. **Vibration** - Haptic feedback for enhanced alerts

## Installation Steps

### 1. Install Dependencies

Run the following command to install the required dependencies:

```bash
npm install
```

### 2. Add Alarm Sound

To enable sound alerts, you need to add an alarm sound file:

1. Create an MP3 file named `alarm.mp3` with a clear, attention-grabbing sound
2. Add the file to `assets/sounds/`
3. For Android: Copy `alarm.mp3` to `android/app/src/main/res/raw/` (create the directory if needed)
4. For iOS: Add the file to your Xcode project (see `assets/sounds/README.md` for detailed instructions)

### 3. Rebuild Application

After adding the sound files and installing dependencies, rebuild the application:

```bash
# For Android
npm run android

# For iOS
npm run ios
```

## Using the Alert Feature

The alert system will automatically:

1. Monitor all new glucose readings
2. Trigger an alert when values exceed thresholds (below 70 mg/dL or above 180 mg/dL)
3. Play an alarm sound and show an alert modal
4. Add the alert to your alert history

To acknowledge an alert:
1. Press the "ACKNOWLEDGE" button on the alert modal
2. The alarm will stop and the reading will be saved to your alert history

## Customizing Alert Thresholds

If you want to customize the alert thresholds, you can modify:

1. `services/AlertService.ts` - Look for the `LOW_THRESHOLD` and `HIGH_THRESHOLD` constants
2. `services/FreeStyleLibreService.ts` - Look for the `GLUCOSE_LOW` and `GLUCOSE_HIGH` constants in the `isGlucoseInAlertRange` method

## Troubleshooting

If alerts aren't working:

1. **No sound**: Check that the `alarm.mp3` file exists in the correct locations and your device isn't muted.
2. **No vibration**: Ensure your device supports vibration and is not in Do Not Disturb mode.
3. **No alerts appearing**: Verify that the high/low thresholds are set correctly and that your readings are actually outside the normal range.

## Testing

To test the alert system, you can:

1. Manually enter a glucose reading above 180 mg/dL or below 70 mg/dL.
2. Use test mode in the app (if available) to simulate high/low readings.
3. Modify the threshold values temporarily to trigger alerts with regular readings. 