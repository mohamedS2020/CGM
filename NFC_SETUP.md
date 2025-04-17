# NFC Setup Guide for CGM App

This guide explains how to set up and test NFC functionality in the CGM app on physical devices.

## Prerequisites

- Node.js (v14 or later)
- Expo CLI: `npm install -g expo-cli`
- Android Studio (for Android development) 
- Xcode (for iOS development)
- A physical Android or iOS device with NFC capabilities
- Development signing certificates (for iOS)

## Important: NFC Limitations in Expo Go

NFC functionality is **not available** in the Expo Go app. You must create a development build to use NFC features. This is because NFC requires native modules that aren't included in Expo Go.

## Setup Instructions

### 1. Install Required Packages

```bash
# Install NFC Manager
npm install react-native-nfc-manager

# Install required Expo dependencies
npm install expo-constants
```

### 2. Configure Your Project

The app.json file has been updated with the necessary NFC configurations. Make sure it includes:

- The NFC plugin configuration
- Android NFC permissions
- iOS NFC entitlements

### 3. Build and Run on a Physical Device

#### Android Setup

1. Install development build:

```bash
npx expo prebuild --platform android  # Only needed first time
npx expo run:android
```

2. Make sure NFC is enabled on your Android device:
   - Go to Settings > Connected devices > Connection preferences > NFC
   - Turn on NFC

#### iOS Setup

1. You need an Apple Developer account for NFC capabilities
2. Configure your app identifier with NFC capabilities in the Apple Developer Portal
3. Update your provisioning profiles
4. Build and install:

```bash
npx expo prebuild --platform ios  # Only needed first time
npx expo run:ios
```

### 4. Testing NFC

1. Launch the app on your physical device
2. Navigate to the Sensor screen
3. Press "Scan New Sensor"
4. Hold your phone near an NFC tag
5. Watch for the tag detection output in the console

## Troubleshooting

### "Cannot convert null value to object" Error

This error typically occurs when:
- NFC is not properly initialized
- NFC manager is accessed before it's ready
- Attempting to use NFC in Expo Go

The app now includes:
- Proper null checks for the NFC manager
- Graceful fallback when NFC is not available
- Expo Go detection and warning message

### NFC Not Detecting Tags

1. Verify NFC is enabled in device settings
2. Check that you're using a supported NFC tag format (ISO 15693 for CGM sensors)
3. Make sure you're using a development build, not Expo Go
4. Try moving the tag closer to the NFC antenna on your device

### Android-specific Issues

- Some Android devices require the app to be in the foreground for NFC to work
- Ensure the app has the proper NFC permissions in Android settings

### iOS-specific Issues

- iOS requires CoreNFC capability in the provisioning profile
- iOS restricts NFC reading to foreground sessions with user initiation
- Verify your Apple Developer account includes NFC Entitlements

## Development Notes

- Use `console.log` statements to debug NFC operations
- Check the app's console output for NFC initialization status
- The app will display a warning when running in Expo Go

## Further Resources

- [react-native-nfc-manager Documentation](https://github.com/revtel/react-native-nfc-manager)
- [Expo Development Builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [NFC Tag Types Reference](https://www.rfidcard.com/nfc-tag-types-explained/) 