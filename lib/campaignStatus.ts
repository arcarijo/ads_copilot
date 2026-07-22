/**
 * Campaign statuses from which a launch may be attempted.
 *
 * - READY: Copilot-approved and never launched.
 * - ERROR: a prior launch attempt failed (e.g. a Meta permission or billing
 *   problem). ERROR is only ever reached *from* a failed launch of a
 *   previously-approved campaign — the plan and inputs are unchanged and still
 *   valid, so the launch can be safely retried once the underlying cause is
 *   fixed. Blocking retry here is exactly what softlocked clients whose first
 *   launch failed: the preflight gate demanded READY, but a failed launch had
 *   already flipped the status to ERROR with no way back.
 *
 * DRAFT / NEEDS_CLARIFICATION are deliberately excluded — those haven't cleared
 * Copilot review. ACTIVE / LAUNCHING are already live and must be stopped, not
 * relaunched.
 */
export const LAUNCH_ELIGIBLE_STATUSES = ["READY", "ERROR"] as const;

export function isLaunchEligibleStatus(status: string): boolean {
  return (LAUNCH_ELIGIBLE_STATUSES as readonly string[]).includes(status);
}
