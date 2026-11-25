"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const PRAYER_NAMES: Record<string, string> = {
  fajr: "Fajr",
  dhuhr: "Dhouhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

type PrayerTimes = { fajr: string; dhuhr: string; asr: string; maghrib: string; isha: string };

async function fetchPrayerTimes(prefs: {
  latitude: number;
  longitude: number;
  school: number;
}): Promise<PrayerTimes | null> {
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;

  const params = new URLSearchParams({
    latitude: String(prefs.latitude),
    longitude: String(prefs.longitude),
    method: "99",
    methodSettings: "15,null,15",
    tune: "0,0,0,0,0,4,0,0,0",
    latitudeAdjustmentMethod: "3",
    school: String(prefs.school),
  });

  try {
    const res = await fetch(`https://api.aladhan.com/v1/timings/${dateStr}?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: number;
      data?: { timings?: Record<string, string> };
    };
    if (data.code !== 200 || !data.data?.timings) return null;
    const t = data.data.timings;

    const normalize = (val: string | undefined) => {
      if (!val) return "";
      const m = val.match(/^(\d{1,2}):(\d{2})/);
      return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
    };

    const fajr = normalize(t.Fajr);
    const dhuhr = normalize(t.Dhuhr);
    const asr = normalize(t.Asr);
    const maghrib = normalize(t.Maghrib);
    const isha = normalize(t.Isha);

    if (!fajr || !dhuhr || !asr || !maghrib || !isha) return null;
    return { fajr, dhuhr, asr, maghrib, isha };
  } catch {
    return null;
  }
}

export const computeAndSendForUser = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const prefs = await ctx.runQuery(internal.prayerReminders.getUserPrefsInternal, { userId });
    if (!prefs || !prefs.reminderEnabled) return;

    const subs = await ctx.runQuery(internal.prayerReminders.getUserSubscriptions, { userId });
    if (subs.length === 0) return;

    const times = await fetchPrayerTimes(prefs);
    if (!times) return;

    const now = new Date();
    const prayers = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;

    for (const prayer of prayers) {
      if (!prefs.prayers[prayer]) continue;

      const timeStr = times[prayer];
      if (!timeStr) continue;

      const [hours, minutes] = timeStr.split(":").map(Number);
      const prayerDate = new Date(now);
      prayerDate.setHours(hours, minutes, 0, 0);

      const notifyAt = new Date(prayerDate.getTime() - prefs.reminderMinutesBefore * 60_000);
      const delay = notifyAt.getTime() - now.getTime();

      if (delay > 0) {
        await ctx.scheduler.runAfter(delay, internal.prayerRemindersNode.sendPushToUser, {
          userId,
          prayer: prayer,
          minutesBefore: prefs.reminderMinutesBefore,
          prayerTime: timeStr,
        });
      }
    }
  },
});

export const scheduleAdhkarForUser = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const prefs = await ctx.runQuery(internal.prayerReminders.getAdhkarPrefsInternal, { userId });
    if (!prefs) return;

    const subs = await ctx.runQuery(internal.prayerReminders.getUserSubscriptions, { userId });
    if (subs.length === 0) return;

    const now = new Date();

    const sessions: { key: string; enabled: boolean; time: string; title: string; body: string }[] = [
      {
        key: "adhkar-morning",
        enabled: prefs.morningEnabled,
        time: prefs.morningTime,
        title: "Adhkar du matin",
        body: "C'est l'heure de tes invocations du matin.",
      },
      {
        key: "adhkar-evening",
        enabled: prefs.eveningEnabled,
        time: prefs.eveningTime,
        title: "Adhkar du soir",
        body: "C'est l'heure de tes invocations du soir.",
      },
    ];

    for (const session of sessions) {
      if (!session.enabled) continue;

      const [hours, minutes] = session.time.split(":").map(Number);
      const target = new Date(now);
      target.setHours(hours, minutes, 0, 0);
      const delay = target.getTime() - now.getTime();

      if (delay > 0) {
        await ctx.scheduler.runAfter(delay, internal.prayerRemindersNode.sendAdhkarPush, {
          userId,
          sessionKey: session.key,
          title: session.title,
          body: session.body,
        });
      }
    }
  },
});

export const sendAdhkarPush = internalAction({
  args: {
    userId: v.id("users"),
    sessionKey: v.string(),
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, { userId, sessionKey, title, body }) => {
    const subs = await ctx.runQuery(internal.prayerReminders.getUserSubscriptions, { userId });
    if (subs.length === 0) return;

    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error("VAPID keys manquantes");
      return;
    }

    const webpush = await import("web-push");
    webpush.setVapidDetails("mailto:contact.rawdah@sdlevelup.fr", vapidPublicKey, vapidPrivateKey);

    const payload = JSON.stringify({
      title,
      body,
      icon: "/logo.svg",
      badge: "/logo.svg",
      tag: sessionKey,
      data: { adhkar: true },
    });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await ctx.runMutation(internal.prayerReminders.deleteSubscription, {
            endpoint: sub.endpoint,
          });
        }
      }
    }
  },
});

export const sendPushToUser = internalAction({
  args: {
    userId: v.id("users"),
    prayer: v.string(),
    minutesBefore: v.number(),
    prayerTime: v.string(),
  },
  handler: async (ctx, { userId, prayer, minutesBefore, prayerTime }) => {
    const subs = await ctx.runQuery(internal.prayerReminders.getUserSubscriptions, { userId });
    if (subs.length === 0) return;

    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error("VAPID keys manquantes");
      return;
    }

    const webpush = await import("web-push");
    webpush.setVapidDetails("mailto:contact.rawdah@sdlevelup.fr", vapidPublicKey, vapidPrivateKey);

    const prayerName = PRAYER_NAMES[prayer] || prayer;
    const title = minutesBefore > 0
      ? `${prayerName} dans ${minutesBefore} min`
      : `C'est l'heure de ${prayerName}`;
    const body = minutesBefore > 0
      ? `${prayerName} est à ${prayerTime}. Prépare-toi.`
      : `Il est ${prayerTime}.`;

    const payload = JSON.stringify({
      title,
      body,
      icon: "/logo.svg",
      badge: "/logo.svg",
      tag: `prayer-${prayer}`,
      data: { prayer, prayerTime },
    });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await ctx.runMutation(internal.prayerReminders.deleteSubscription, {
            endpoint: sub.endpoint,
          });
        }
      }
    }
  },
});
