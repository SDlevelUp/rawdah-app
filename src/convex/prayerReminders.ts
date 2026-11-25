import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  mutation,
  query,
  internalQuery,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const prayersValidator = v.object({
  fajr: v.boolean(),
  dhuhr: v.boolean(),
  asr: v.boolean(),
  maghrib: v.boolean(),
  isha: v.boolean(),
});

// ── Préférences de prière (localisation + rappels) ──

export const getPreferences = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return await ctx.db
      .query("prayerPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const savePreferences = mutation({
  args: {
    latitude: v.number(),
    longitude: v.number(),
    placeLabel: v.optional(v.string()),
    school: v.number(),
    reminderEnabled: v.boolean(),
    reminderMinutesBefore: v.number(),
    prayers: prayersValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Connecte-toi pour enregistrer.");

    if (args.latitude < -90 || args.latitude > 90) throw new Error("Latitude invalide.");
    if (args.longitude < -180 || args.longitude > 180) throw new Error("Longitude invalide.");
    if (args.reminderMinutesBefore < 0 || args.reminderMinutesBefore > 120)
      throw new Error("Le délai doit être entre 0 et 120 minutes.");

    const existing = await ctx.db
      .query("prayerPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const data = { userId, ...args };
    if (existing) {
      await ctx.db.replace(existing._id, data);
    } else {
      await ctx.db.insert("prayerPreferences", data);
    }

    if (args.reminderEnabled) {
      await ctx.scheduler.runAfter(0, internal.prayerRemindersNode.computeAndSendForUser, {
        userId,
      });
    } else {
      await cancelPending(ctx, "sendPushToUser", userId);
    }
  },
});

// ── Subscriptions push ──

export const saveSubscription = mutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  },
  handler: async (ctx, { endpoint, p256dh, auth }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Connecte-toi pour enregistrer.");

    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { userId, p256dh, auth });
    } else {
      await ctx.db.insert("pushSubscriptions", {
        userId,
        endpoint,
        p256dh,
        auth,
        createdAt: Date.now(),
      });
    }
  },
});

export const removeSubscription = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return;
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing && existing.userId === userId) {
      await ctx.db.delete(existing._id);
    }
  },
});

// ── Préférences adhkar (matin / soir) ──

export const getAdhkarPreferences = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return await ctx.db
      .query("adhkarPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const saveAdhkarPreferences = mutation({
  args: {
    morningEnabled: v.boolean(),
    morningTime: v.string(),
    eveningEnabled: v.boolean(),
    eveningTime: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Connecte-toi pour enregistrer.");

    const timeRe = /^\d{2}:\d{2}$/;
    if (!timeRe.test(args.morningTime) || !timeRe.test(args.eveningTime))
      throw new Error("Format d'heure invalide (HH:MM attendu).");

    const existing = await ctx.db
      .query("adhkarPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const data = { userId, ...args };
    if (existing) {
      await ctx.db.replace(existing._id, data);
    } else {
      await ctx.db.insert("adhkarPreferences", data);
    }

    if (args.morningEnabled || args.eveningEnabled) {
      await ctx.scheduler.runAfter(0, internal.prayerRemindersNode.scheduleAdhkarForUser, {
        userId,
      });
    } else {
      await cancelPending(ctx, "sendAdhkarPush", userId);
    }
  },
});

export const getAdhkarPrefsInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("adhkarPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

// ── Queries internes (appelées par les actions Node.js) ──

export const getUserPrefsInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("prayerPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const getUserSubscriptions = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const deleteSubscription = internalMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const sub = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (sub) await ctx.db.delete(sub._id);
  },
});

// ── Remplacement des envois programmés (évite les doublons) ──

// Annule les envois encore en attente de cette fonction : pour cette
// utilisatrice si `userId` est donné, et seulement ceux prévus dans
// `window` (le jour local recalculé) si elle est donnée.
async function cancelPending(
  ctx: MutationCtx,
  functionName: string,
  userId?: Id<"users">,
  window?: { start: number; end: number },
) {
  const pending = await ctx.db.system
    .query("_scheduled_functions")
    .filter((q) => q.eq(q.field("state.kind"), "pending"))
    .collect();
  for (const job of pending) {
    if (!job.name.endsWith(`:${functionName}`)) continue;
    const jobUserId = (job.args[0] as { userId?: string } | undefined)?.userId;
    if (userId !== undefined && jobUserId !== userId) continue;
    if (window && (job.scheduledTime < window.start || job.scheduledTime >= window.end)) continue;
    await ctx.scheduler.cancel(job._id);
  }
}

const dayWindow = v.object({ start: v.number(), end: v.number() });

export const replacePrayerPushes = internalMutation({
  args: {
    userId: v.id("users"),
    minutesBefore: v.number(),
    window: dayWindow,
    items: v.array(v.object({ at: v.number(), prayer: v.string(), prayerTime: v.string() })),
  },
  handler: async (ctx, { userId, minutesBefore, window, items }) => {
    await cancelPending(ctx, "sendPushToUser", userId, window);
    for (const item of items) {
      await ctx.scheduler.runAt(item.at, internal.prayerRemindersNode.sendPushToUser, {
        userId,
        prayer: item.prayer,
        minutesBefore,
        prayerTime: item.prayerTime,
      });
    }
  },
});

export const replaceAdhkarPushes = internalMutation({
  args: {
    userId: v.id("users"),
    window: dayWindow,
    items: v.array(
      v.object({ at: v.number(), sessionKey: v.string(), title: v.string(), body: v.string() }),
    ),
  },
  handler: async (ctx, { userId, window, items }) => {
    await cancelPending(ctx, "sendAdhkarPush", userId, window);
    for (const item of items) {
      await ctx.scheduler.runAt(item.at, internal.prayerRemindersNode.sendAdhkarPush, {
        userId,
        sessionKey: item.sessionKey,
        title: item.title,
        body: item.body,
      });
    }
  },
});

// ── Scheduler : planifie les rappels quotidiens ──

export const scheduleDailyReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Rappels de prière
    const allPrefs = await ctx.db.query("prayerPreferences").collect();
    const enabledPrefs = allPrefs.filter((p) => p.reminderEnabled);

    for (const prefs of enabledPrefs) {
      await ctx.scheduler.runAfter(0, internal.prayerRemindersNode.computeAndSendForUser, {
        userId: prefs.userId,
      });
    }

    // Rappels d'adhkar
    const allAdhkar = await ctx.db.query("adhkarPreferences").collect();
    const enabledAdhkar = allAdhkar.filter((a) => a.morningEnabled || a.eveningEnabled);

    for (const prefs of enabledAdhkar) {
      await ctx.scheduler.runAfter(0, internal.prayerRemindersNode.scheduleAdhkarForUser, {
        userId: prefs.userId,
      });
    }

    // Se re-planifier pour demain à 00:05 UTC, en annulant toute autre
    // chaîne en attente (sinon chaque rappel partirait en double).
    await cancelPending(ctx, "scheduleDailyReminders");
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 5, 0, 0);
    const delay = tomorrow.getTime() - now.getTime();
    await ctx.scheduler.runAfter(delay, internal.prayerReminders.scheduleDailyReminders, {});
  },
});

export const bootstrapScheduler = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.prayerReminders.scheduleDailyReminders, {});
  },
});
