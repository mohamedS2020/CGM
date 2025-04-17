# Managing Secrets in EAS Builds

This guide explains how to securely manage environment variables and secrets for your Expo application when building with EAS.

## Local Development

For local development, we use the `.env` file which contains your environment variables. This file is **not** committed to git (it's in `.gitignore`).

## EAS Build Secrets

To securely use your secrets during EAS builds, you can use EAS Secrets. Here's how to set them up:

### 1. Install the EAS CLI (if not already installed)

```bash
npm install -g eas-cli
```

### 2. Log in to your Expo account

```bash
eas login
```

### 3. Set up your secrets

You can set secrets for specific environments (production, development, etc.) using the EAS CLI:

```bash
# Firebase configuration
eas secret:create --scope project --name FIREBASE_API_KEY --value "your-api-key" --type string
eas secret:create --scope project --name FIREBASE_AUTH_DOMAIN --value "your-auth-domain" --type string
eas secret:create --scope project --name FIREBASE_PROJECT_ID --value "your-project-id" --type string
eas secret:create --scope project --name FIREBASE_STORAGE_BUCKET --value "your-storage-bucket" --type string
eas secret:create --scope project --name FIREBASE_MESSAGING_SENDER_ID --value "your-messaging-sender-id" --type string
eas secret:create --scope project --name FIREBASE_APP_ID --value "your-app-id" --type string
eas secret:create --scope project --name FIREBASE_MEASUREMENT_ID --value "your-measurement-id" --type string

# Cloudinary configuration
eas secret:create --scope project --name CLOUDINARY_CLOUD_NAME --value "your-cloud-name" --type string
eas secret:create --scope project --name CLOUDINARY_UPLOAD_PRESET --value "your-upload-preset" --type string
```

You can view your secrets with:

```bash
eas secret:list
```

### 4. Update eas.json to use secrets

Your `eas.json` file should be configured to use the secrets. Here's an example configuration:

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": {
        "FIREBASE_API_KEY": "YOUR_DEV_API_KEY_HERE"
      }
    },
    "preview": {
      "distribution": "internal",
      "env": {
        "FIREBASE_API_KEY": "YOUR_PREVIEW_API_KEY_HERE"
      }
    },
    "production": {
      "autoIncrement": true,
      "android": {
        "buildType": "apk"
      },
      "env": {}
    }
  }
}
```

For production builds, EAS will use the secrets you've set with the EAS CLI, so you don't need to specify them in the `eas.json` file.

## Security Best Practices

1. **NEVER** commit your `.env` file to version control
2. Use different API keys for development and production environments when possible
3. Regularly rotate your secrets
4. Limit access to your EAS secrets to only team members who need it
5. When setting up CI/CD, ensure that secrets are properly managed in your workflow 