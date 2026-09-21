# Building SoulLog for phones

SoulLog's phone app is the same React app, wrapped by Capacitor. There is
no second codebase: `frontend/dist` is copied into a native shell, and the
shell's job is to host the web view, hold the app's identity in the store,
and ask for the two permissions the app actually needs.

The native projects live at `frontend/android` and `frontend/ios` and are
committed, because they carry real configuration — the Android manifest
and the iOS `Info.plist` were both edited by hand and regenerating them
would throw that away.

## The short version

```bash
cd frontend
npm ci
VITE_API_BASE_URL=https://your-api.example.com/api/v1 npm run build
npx cap sync
npx cap open android      # or: npx cap open ios
```

`npm run build` is not optional and not implied. Capacitor copies whatever
is in `dist/` — if you skip the build you ship the previous one.

## The API URL is baked in at build time

Vite inlines `VITE_API_BASE_URL` when it builds. The app does not read it
at runtime, so **a build points at exactly one backend for the rest of its
life**. A build made with the default `localhost` value will work in a
desktop browser on the machine that built it and nowhere else: on a phone,
`localhost` is the phone.

So: set `VITE_API_BASE_URL` to an address the phone can reach — your
machine's LAN address while testing, the real API for anything you hand to
someone else — and rebuild when it changes.

Use `https` for any build that leaves your desk. Android blocks plain HTTP
by default, and `android.allowMixedContent` is `false` in the Capacitor
config deliberately; if you need HTTP against a local backend, that is what
the live reload mode below is for.

## Live reload, and the bug that made it necessary to explain

`capacitor.config.ts` used to contain this, unconditionally:

```ts
server: { url: 'http://192.168.1.36:5173', cleartext: true }
```

That is the live reload setup: the app on the phone loads the Vite dev
server on a laptop, so saving a file updates the phone immediately. It is
genuinely useful — and it was set for *every* build, including any build
that might have been handed to a tester or uploaded to a store. Such a
build would try to reach a web server on somebody's home network, find
nothing, and show a white screen. It is the kind of defect that is
invisible on the machine it was configured on and total everywhere else.

Live reload is opt-in now:

```bash
cd frontend
npm run dev -- --host          # serve on your LAN, not just localhost
CAP_SERVER_URL=http://192.168.1.36:5173 npx cap sync android
CAP_SERVER_URL=http://192.168.1.36:5173 npx cap run android
```

With `CAP_SERVER_URL` unset — which is every build that is not that one —
no `server` block is written at all and the app loads the bundled `dist/`.
CI asserts this: the Android job fails if the synced config contains a
`server` block.

## Permissions, and why there are only two

**Android** (`frontend/android/app/src/main/AndroidManifest.xml`):

| Permission | Why |
| --- | --- |
| `INTERNET` | The API and the live message socket. |
| `RECORD_AUDIO` | Voice journal entries. `CreateJournal` records with `MediaRecorder`. |

`android.hardware.microphone` is declared with `required="false"`: the app
is perfectly usable without a microphone, and marking it required would
hide SoulLog from devices that lack one.

There is deliberately no storage permission. Attachments are chosen through
the system picker, which hands the app the one file the user selected and
needs no permission on any supported Android version. Asking for
`READ_EXTERNAL_STORAGE` would be asking to read someone's entire library in
order to do something the picker already does.

There is also deliberately no `CAMERA`. Nothing in the app opens a camera
today. When the mentor calling feature exists, it adds `CAMERA` then — a
manifest that asks for more than the app uses costs trust at install time
and costs a review at submission.

**iOS** (`frontend/ios/App/App/Info.plist`): `NSMicrophoneUsageDescription`
and `NSPhotoLibraryUsageDescription`. iOS rejects a build that uses the
microphone without a usage string, and that sentence is the only
explanation the user ever sees, so both say what the app does with the
thing rather than asking for access in the abstract.

## Checking it on a device

The web app is covered by the test suite and by browser tests. What those
cannot cover is the part that only exists on a phone. Walk through this on
a real device before any release:

1. **It opens at all.** A white screen on launch almost always means the
   web assets were not synced or a `server.url` is pointing somewhere
   unreachable.
2. **Sign in, then force-quit and reopen.** Tokens are kept in Capacitor
   Preferences, which is native storage rather than browser storage; this
   is the check that the session survives.
3. **Record a voice entry.** The microphone prompt should appear the first
   time, with the sentence above, and the entry should play back after
   saving.
4. **Attach a photo** to a post and to a message.
5. **Send a message to a second account** and confirm it arrives without a
   refresh — that is the WebSocket working over mobile data, which is a
   different path from Wi-Fi.
6. **Turn the screen off for a minute and come back**: the socket
   reconnects rather than leaving the thread dead.
7. **Airplane mode.** Errors should read as "couldn't reach the server",
   and the app should recover when the network returns rather than needing
   a restart.

## What CI does and does not prove

The `android` job in `.github/workflows/ci.yml` builds the web assets,
syncs Capacitor, asserts that no dev-server URL made it into the config,
and assembles a debug APK, which is uploaded as an artifact. That proves
the native project compiles and that a build is installable.

It does not prove the app *works* on a phone — CI has no phone. The list
above is that check, and it is a person with a device, not a pipeline.

iOS is not built in CI: it needs a macOS runner and a signing identity.
`npx cap open ios` and a build in Xcode is the equivalent, done by hand.
