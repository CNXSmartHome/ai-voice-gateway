# Mobile App

React Native application for the AI Voice Gateway, built with **Expo SDK 57**
and a custom development build. See
[`docs/adr/0002-mobile-framework.md`](../../docs/adr/0002-mobile-framework.md)
for why Expo and what it costs.

**Expo Go will not run this app.** The add-gateway flow needs a native BLE
module, so development happens against a build of the app itself.

## What works today (VG-008, first half)

Sign in, stay signed in across a restart, and sign out. That is the
foundation the rest of the task stands on: an API client with the error
shapes the server actually returns, and an access token in the platform
keystore.

Adding a gateway — scanning for a `VG100-XXXXX` device over BLE, provisioning
it onto Wi-Fi, and claiming it — is the second half. It is also blocked on
[#30](https://github.com/CNXSmartHome/ai-voice-gateway/issues/30): claiming
needs a `propertyId`, and the API has no endpoint that produces one yet.

## Layout

```
app/                  Screens. expo-router maps files to routes.
src/api/              API client, typed against docs/API.md
src/session/          Token storage and the sign-in state machine
src/ui/               The little shared visual vocabulary there is so far
test/                 Unit tests, run by the root `npm run test:unit`
```

### Why the logic is not in the components

`src/` holds no React. The API client takes `fetch` as an argument, the token
store takes a storage interface, and sign-in is a controller that reports
states. The screens in `app/` bind them to inputs and a spinner.

That split is what makes the tests worth having. Everything with a decision in
it — how an HTTP status becomes an error the UI can act on, when a stored
token is too close to expiry to use, that a failed sign-in does not reveal
whether the account exists — is asserted directly, with no renderer, no native
module, and no React Native transform in the test setup.

## Configuration

One variable, and only one:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
```

`EXPO_PUBLIC_*` values are substituted into the JavaScript bundle at build
time, which makes them readable by anyone who has the app. A base URL is fine
that way; nothing else is, which is why no key, token, or credential is
configured this way.

It is validated at startup rather than at the first request, so a build made
without it says what is missing instead of failing later at a sign-in screen.

## Running it

```bash
npm install                                   # from the repository root
npm run android --workspace @vg/mobile        # or `ios`, which needs macOS
```

Both commands build and install a development build, then start the bundler.
`expo prebuild` runs as part of them and generates `ios/` and `android/` from
`app.json`. **Those directories are build output and are git-ignored** —
editing them works until the next prebuild wipes them. Native configuration
belongs in `app.json` or in a config plugin.

## Checks

The root commands cover this workspace; there is nothing extra to remember.

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test:unit
EXPO_PUBLIC_API_URL=https://api.invalid npm run bundle --workspace @vg/mobile
```

The bundle is the interesting one. It runs Metro over both platforms without
any native toolchain, so an import that typechecks but cannot resolve at
runtime fails here rather than on someone's phone. It caught a missing
`@expo/ui` dependency the day it was added. CI runs it on every pull request.

## Security

- The access token is stored with `expo-secure-store`, which is the iOS
  keychain and the Android keystore — not AsyncStorage, which is a plain file
  on the device. It is written with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so a
  backup restored onto another phone does not carry a live session.
- A token within 30 seconds of expiry is treated as expired and removed.
  There is no refresh endpoint yet
  ([#17](https://github.com/CNXSmartHome/ai-voice-gateway/issues/17)), so an
  expired token can only leak, never help.
- A failed sign-in says the same thing whether the password was wrong or the
  account does not exist. VG-004 refuses to distinguish them so the API cannot
  be used to discover which addresses have accounts, and a friendlier message
  here would give that away instead.
- Passwords are never stored, logged, or included in an error. Network
  failures are reported without the underlying error, which can carry the URL
  and request detail.

## Planned scope

| Task | Description |
| --- | --- |
| VG-008 | Foundation — **done**; add-gateway flow follows |
| VG-013 | Room assignment |
| VG-036 | UI cleanup |
