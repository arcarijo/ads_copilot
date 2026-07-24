/**
 * Plain-English "how do I fix this" guidance for failing preflight checks,
 * client-safe (no server imports) so it can be used directly from the
 * New Campaign UI. Keyed by the exact PreflightCheck.item string emitted by
 * lib/preflight.ts / lib/meta.ts — a rename there means a rename here too.
 */
export interface CheckResolution {
  instructions: string;
  actionLabel?: string;
  actionHref?: (clientId?: string) => string | null;
}

const RESOLUTIONS: Record<string, CheckResolution> = {
  "Meta: Access token": {
    instructions:
      'The saved Meta access token is invalid or has expired. In Meta Business Settings, go to Users → System Users, select the system user for this account, and click "Generate New Token" with the same permissions as before. Then paste the new token into this client\'s settings.',
    actionLabel: "Update token in Client Settings",
    actionHref: (clientId) => (clientId ? `/clients/${clientId}` : null),
  },
  "Meta: Ad account status": {
    instructions:
      "This ad account is disabled or restricted on Meta's side. Open Meta Ads Manager and check the Account Overview for the exact restriction reason — Meta is the final authority here, so this can't be fixed from within this app.",
  },
  "Meta: Funding source": {
    instructions:
      "No valid payment method is on file for this ad account. In Meta Ads Manager, go to Billing & Payments and add or update a payment method.",
  },
  "Meta: Custom Audience Terms of Service": {
    instructions:
      "The ad account hasn't accepted Meta's Custom Audience Terms of Service, which is required before targeting a Custom Audience. Have the account owner accept them (the direct link is in the detail message above), then retry — nothing about the campaign needs to change.",
  },
  "Meta: Facebook Page access": {
    instructions:
      'The saved token can\'t reach the connected Facebook Page — either the Page ID is wrong, or the System User isn\'t assigned to that Page. In Meta Business Settings, go to Accounts → Pages, select the Page, and assign the System User with "Manage Page" access. If the Page ID itself is wrong, correct it in this client\'s settings.',
    actionLabel: "Update Page ID in Client Settings",
    actionHref: (clientId) => (clientId ? `/clients/${clientId}` : null),
  },
  "Meta: Instagram account access": {
    instructions:
      "The connected Facebook Page doesn't have a linked Instagram professional account, or the token wasn't generated with Instagram permission. In Meta Business Settings, go to Accounts → Instagram accounts and connect the client's Instagram account to this Page, then regenerate the System User token so it includes Instagram permissions. Once you have the new token, update it here.",
    actionLabel: "Update token in Client Settings",
    actionHref: (clientId) => (clientId ? `/clients/${clientId}` : null),
  },
  "Meta: Ad creation permission": {
    instructions:
      'The token doesn\'t have permission to create ads on this account. In Meta Business Settings, go to Accounts → Ad Accounts, select this ad account, and assign the System User with "Manage campaigns" access — then regenerate the token so it picks up the new permission and update it here.',
    actionLabel: "Update token in Client Settings",
    actionHref: (clientId) => (clientId ? `/clients/${clientId}` : null),
  },
  "Facebook Page": {
    instructions:
      "No Facebook Page is linked to this client, so ads have nowhere to publish from. Add the client's Page ID in their client settings.",
    actionLabel: "Add Page ID in Client Settings",
    actionHref: (clientId) => (clientId ? `/clients/${clientId}` : null),
  },
};

export function getCheckResolution(item: string): CheckResolution | undefined {
  return RESOLUTIONS[item];
}
