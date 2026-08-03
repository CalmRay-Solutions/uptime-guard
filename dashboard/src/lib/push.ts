import { api } from "./api";

/** VAPID public keys are base64url; the Push API wants the raw bytes. */
function urlB64ToBytes(base64: string): Uint8Array {
  const norm = base64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((base64.length + 3) % 4);
  const bin = atob(norm);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Subscribe this browser for server-pushed alerts (works with the app closed). */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api.pushKey();
  if (!key) return; // server has no VAPID key configured
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(key) as BufferSource });
  }
  const j = sub.toJSON();
  if (j.keys?.p256dh && j.keys.auth) {
    await api.pushSubscribe({ endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  }
}

/** Remove this browser's push subscription. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
