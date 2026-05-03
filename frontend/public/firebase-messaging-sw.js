/**
 * Firebase Messaging Service Worker (T34).
 *
 * Handles background push messages when the JACOB tab is not in focus.
 * Uses Firebase compat SDK via CDN importScripts.
 *
 * On Firebase Hosting, `/__/firebase/init.js` automatically serves the
 * correct project config. For local dev without Hosting, background push
 * requires a manually set `self.__firebase_config__` (set via postMessage
 * from the app), which is optional — foreground push still works.
 */

/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

let _messagingReady = false;

function tryInit(config) {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    }
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const title = payload.notification?.title ?? "JACOB";
      const body = payload.notification?.body ?? "";
      self.registration.showNotification(title, {
        body,
        icon: "/icons/icon-192x192.png",
        badge: "/icons/badge-96x96.png",
        tag: payload.collapseKey ?? "jacob-push",
      });
    });
    _messagingReady = true;
  } catch (e) {
    console.warn("[firebase-messaging-sw] init failed:", e);
  }
}

// Firebase Hosting auto-serves config at /__/firebase/init.json
fetch("/__/firebase/init.json")
  .then((r) => r.json())
  .then(tryInit)
  .catch(() => {
    // Not on Firebase Hosting; wait for config from the page via postMessage.
  });

self.addEventListener("message", (event) => {
  if (event.data?.type === "FIREBASE_CONFIG" && !_messagingReady) {
    tryInit(event.data.config);
  }
});
