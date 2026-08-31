import * as SecureStore from 'expo-secure-store';

import type { SecureStorage } from './token-store';

/**
 * The real storage: the iOS keychain and the Android keystore.
 *
 * Not AsyncStorage, which is a plain file that any process with the app's
 * data directory can read -- on a rooted or jailbroken device, that includes
 * processes the user did not install.
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` keeps the token out of iCloud keychain
 * backups, so a restore onto a second phone does not carry a live session
 * with it. There is no refresh token to lose (#17): the cost of this is one
 * sign-in after a device migration.
 *
 * The only file in the app that touches a native module, and the reason the
 * rest of `session/` takes an interface instead.
 */
export const secureStorage: SecureStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};
