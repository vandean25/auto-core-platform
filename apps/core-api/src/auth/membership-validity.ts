export type MembershipDemoTiming = {
  demo_access_expires_at: Date | null;
};

/** Matches session auth: demo memberships expire when demo_access_expires_at is in the past. */
export function isMembershipCurrentlyValid(
  membership: MembershipDemoTiming,
  nowMs = Date.now(),
): boolean {
  if (!membership.demo_access_expires_at) {
    return true;
  }
  return membership.demo_access_expires_at.getTime() > nowMs;
}
