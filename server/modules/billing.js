'use strict';
/**
 * BILLING MODULE — STUB (no payment gateway, by design).
 *
 * Everything money-related funnels through this one file. To add Stripe /
 * Razorpay / Paddle / LemonSqueezy later:
 *   1. implement the functions below,
 *   2. add a webhook route in server/routes/ that calls `applyPlan()`,
 *   3. nothing else in the codebase changes.
 */
const { S, now, log } = require('../db');
const { db } = require('../db');
const PLANS = {
  free:     { maxRooms: 1, maxParticipants: 4,  maxMinutes: 40 },
  basic:    { maxRooms: 1, maxParticipants: 8,  maxMinutes: 0 },
  educator: { maxRooms: 2, maxParticipants: 12, maxMinutes: 0 },
  campus:   { maxRooms: 4, maxParticipants: 12, maxMinutes: 0 }
};
function applyPlan(userId, planName, expiresAt = null) {
  const p = PLANS[planName]; if (!p) throw new Error('unknown plan: ' + planName);
  db.prepare(`UPDATE users SET plan=?, max_rooms=?, max_participants=?, max_minutes=?, expires_at=?, active=1
              WHERE id=?`).run(planName, p.maxRooms, p.maxParticipants, p.maxMinutes, expiresAt, userId);
  log('billing', 'plan.apply', { userId, planName, expiresAt });
}
module.exports = {
  PLANS,
  applyPlan,
  onAccountCreated(_user) { /* no-op */ },
  onCheckoutCompleted(_evt) { /* implement: applyPlan(evt.userId, evt.plan, evt.periodEnd) */ },
  onSubscriptionCancelled(_evt) { /* implement: set expires_at = period end */ },
  isEnabled() { return false; }
};
