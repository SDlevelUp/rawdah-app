import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../convex/_generated/api";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

type PushState = "unsupported" | "prompt" | "denied" | "granted" | "loading";

export function usePushNotifications() {
  const [state, setState] = useState<PushState>("loading");
  const saveSubscription = useMutation(api.prayerReminders.saveSubscription);
  const removeSubscription = useMutation(api.prayerReminders.removeSubscription);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_PUBLIC_KEY) {
      setState("unsupported");
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        registrationRef.current = reg;
        return reg.pushManager.getSubscription();
      })
      .then((sub) => {
        if (sub) {
          const json = sub.toJSON();
          if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
            void saveSubscription({
              endpoint: json.endpoint,
              p256dh: json.keys.p256dh,
              auth: json.keys.auth,
            });
          }
          setState("granted");
        } else {
          setState(Notification.permission === "denied" ? "denied" : "prompt");
        }
      })
      .catch(() => setState("unsupported"));
  }, [saveSubscription]);

  const subscribe = useCallback(async () => {
    const reg = registrationRef.current;
    if (!reg) return false;

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        return false;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });

      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("Subscription incomplète");
      }

      await saveSubscription({
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      });

      setState("granted");
      return true;
    } catch {
      setState("denied");
      return false;
    }
  }, [saveSubscription]);

  const unsubscribe = useCallback(async () => {
    const reg = registrationRef.current;
    if (!reg) return;

    try {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removeSubscription({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("prompt");
    } catch {
      // Ignore silently
    }
  }, [removeSubscription]);

  return { state, subscribe, unsubscribe };
}
