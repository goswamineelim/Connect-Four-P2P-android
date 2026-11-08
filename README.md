# Connect Four for Android

A two-player Connect Four game built with Expo and React Native. The rules live
in `src/game`, networking lives in `src/networking`, and UI lives in `src/screens`.

## Run on Android

WebRTC requires a custom Android development build; this app cannot run in Expo
Go. Use Node.js 22.13.x or newer, install Android Studio with the Android SDK,
and select a compatible JDK. Then run:

```powershell
npm.cmd install
npm.cmd run android
```

This generates the native Android project and installs the development build on
the connected device or emulator. For later JavaScript-only changes, run
`npm.cmd start` and open the installed Connect Four development build.

To pair two Android devices, open **Connect another device** on both. One player
hosts and displays the Offer QR; the other joins, scans it, and displays an
Answer QR for the host to scan. Public STUN is used for direct NAT discovery;
there is no TURN relay, so some restrictive networks may not connect.

## Checks

```powershell
npm.cmd test
npm.cmd run typecheck
```
