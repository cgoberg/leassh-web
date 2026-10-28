# Leassh support macros — pricing, Free, HA

Approved 2026-10-28. Keep answers short and link to the canonical page.

## "Does Leassh monitor phones?"

> Leassh is for computers: Windows 10/11, Apple Silicon macOS 12+, and Linux. It does not run on Android, iOS, or ChromeOS. For phones and tablets, use Google Family Link (Android/Chromebooks) or Apple Screen Time (iPhone/iPad). The full matrix is at https://leassh.com/platforms.

## "Free vs OpenClaw?"

> They are different things. Leassh Free is a 2-computer server license with the local dashboard, Home Assistant, sensors, presence, notify, Assist, basic alerts, and one `ha` API token. OpenClaw Fleet is a separate free/open-source plugin that connects fleet data to an OpenClaw agent. A Free license does not include OpenClaw; using HA and OpenClaw at the same time requires Family or Pro.

## "How do I cancel?"

> Open https://leassh.com/account, enter your pairing code, and choose Manage billing. Cancellation stops renewal; the license stays valid until the end of the paid period. If you cannot access the portal, email hello@leassh.com and we will cancel it for you.

## "Why did my license expire?"

> Check the plan and status at https://leassh.com/account. Common causes: the paid period ended after cancellation, a renewal payment failed and the 7-day grace period ended, or a refund revoked the license. If the status is wrong, send the license key (never the full card details) to hello@leassh.com.

## "How do I downgrade with too many nodes?"

> Downgrades take effect at the end of the current billing period. If the lower plan has fewer computers, existing nodes keep reporting in degraded mode; new nodes are refused with `NODE_LIMIT_REACHED`. Remove nodes from `fleet.yaml` (or the agent list) until you are within the new limit, or upgrade again. `/api/health` shows `license.node_limit.current`, `max`, and `exceeded`.

## "How do I add a third HA node on Free?"

> Free includes 2 nodes. A third node is rejected with `NODE_LIMIT_REACHED`; this is the plan limit, not a bug. Remove an unused node, or upgrade to Family (10 computers) at https://leassh.com/pricing. Home Assistant is included on every plan; only the node count changes.

## "Why is Home Assistant showing license_invalid?"

> The server returned 503 with `{"error":"license invalid"}`. Open the add-on configuration (or `fleet.yaml`) and update `license_token`. Free keys start with `LSH-`; offline paid tokens start with `LSH1.`. Then reload the integration. The HA repair `license_invalid` links to this fix. This is not a network error, so do not troubleshoot Wi-Fi first.

## "Why is my renewal failing?"

> Stripe could not charge the card. The license enters a 7-day grace period and remains valid while you update the payment method at https://leassh.com/account. After the grace period, validation stops until payment succeeds. We send an email when the charge fails.

## "Is there a founder's price locked for life?"

> No. Leassh does not offer a lifetime price lock. The price at checkout applies for the current billing period; renewals use the then-current price after at least 30 days' notice. See the Terms at https://leassh.com/privacy-policy#terms.

## "What is the refund policy?"

> Email hello@leassh.com within 30 days of a charge and we will refund it to the original payment method. Refunds do not limit statutory rights. A full refund may revoke the associated license.
