import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration.
 *
 * The one thing worth explaining here is `server`.
 *
 * This file used to set `server.url` to a hardcoded LAN address
 * (`http://192.168.1.36:5173`) with `cleartext: true`. That is the live
 * reload setup, and it is very useful while developing — the app on the
 * phone loads the Vite dev server on the laptop, so a save is visible
 * immediately. But it was set unconditionally, which means it would also
 * have been true of a build handed to a tester or uploaded to a store:
 * the app would try to load a web server on someone's home network, find
 * nothing, and show a white screen. It is the kind of defect that is
 * invisible on the machine it was configured on and total everywhere
 * else.
 *
 * So live reload is opt-in now. Set CAP_SERVER_URL to your machine's LAN
 * address when you want it:
 *
 *     CAP_SERVER_URL=http://192.168.1.36:5173 npx cap run android
 *
 * With the variable unset — which is every build that isn't that one —
 * the app loads the bundled `dist/`, which is what a real install must
 * do. `cleartext` follows the same variable, so plain HTTP is never
 * allowed in a build that doesn't ask for it.
 */
const liveReloadUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.threeu.soullog',
  appName: 'SoulLog',
  webDir: 'dist',
  ...(liveReloadUrl
    ? { server: { url: liveReloadUrl, cleartext: liveReloadUrl.startsWith('http://') } }
    : {}),
  android: {
    allowMixedContent: false,
  },
};

export default config;
