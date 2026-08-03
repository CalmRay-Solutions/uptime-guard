import { useEffect, useRef } from "react";
import type { Service } from "./api";
import { statusOf, type StatusKind } from "./derive";
import { playDown, playUp } from "./sound";

const BASE_TITLE = "Uptime Guard";

/**
 * Watches the polled services and reacts to real status transitions:
 *  - up/warn/unknown → down: alarm tone + toast + desktop notification
 *  - down → up: recovery chime + toast
 * Also flashes the browser-tab title while anything is down (so a background tab still signals).
 * The first snapshot is treated as the baseline (no alerts on initial load).
 */
export function useStatusAlerts(
  services: Service[] | null,
  opts: { sound: boolean; notify: boolean; say: (m: string) => void }
) {
  const prev = useRef<Map<string, StatusKind>>(new Map());
  const primed = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!services) return;
    const cur = new Map<string, StatusKind>(services.map((s) => [s.id, statusOf(s)]));

    if (!primed.current) {
      prev.current = cur;
      primed.current = true;
      applyTitle(cur);
      return;
    }

    const downed: Service[] = [];
    const recovered: Service[] = [];
    for (const s of services) {
      const now = cur.get(s.id)!;
      const was = prev.current.get(s.id);
      if (was && was !== now) {
        if (now === "down") downed.push(s);
        else if ((was === "down" || was === "warn") && now === "up") recovered.push(s);
      }
    }
    prev.current = cur;
    applyTitle(cur);

    const o = optsRef.current;
    if (downed.length) {
      if (o.sound) playDown();
      o.say(downed.length === 1 ? `${downed[0].name} went down` : `${downed.length} services went down`);
      if (o.notify) notify("🔴 Service down", downed.map((s) => s.name).join(", "), pathFor(downed));
    } else if (recovered.length) {
      if (o.sound) playUp();
      o.say(recovered.length === 1 ? `${recovered[0].name} recovered` : `${recovered.length} services recovered`);
      if (o.notify) notify("✅ Recovered", recovered.map((s) => s.name).join(", "), pathFor(recovered));
    }
  }, [services]);

  // Restore the title on unmount.
  useEffect(() => () => { document.title = BASE_TITLE; }, []);
}

function applyTitle(cur: Map<string, StatusKind>) {
  let down = 0;
  for (const k of cur.values()) if (k === "down") down++;
  document.title = down > 0 ? `(${down}) 🔴 ${BASE_TITLE}` : BASE_TITLE;
}

/** Deep-link to the single affected service, else the dashboard root. */
function pathFor(list: Service[]): string {
  return list.length === 1 ? `/p/${list[0].project_id}/s/${list[0].id}` : "/";
}

function notify(title: string, body: string, url = "/") {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const opts = { body, tag: "uptime-guard", icon: "/icon.svg", badge: "/icon.svg", data: { url } };
    // Prefer the service worker: notifications survive the tab and support click routing.
    if (navigator.serviceWorker?.ready) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(title, opts))
        .catch(() => new Notification(title, opts));
    } else {
      new Notification(title, opts);
    }
  } catch {
    /* ignore */
  }
}
