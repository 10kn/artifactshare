// Instance UI policy. Human-facing source: repo-root instance.config.json.
// Workers cannot read that JSON at runtime.

export const PRODUCT_DISPLAY_NAME = 'Icon Share'
export const UPSTREAM_PRODUCT_NAME = 'Artifact Share'
export const UPSTREAM_PRODUCT_REPO_URL =
  'https://github.com/artifactshare/artifactshare'
export const HIDE_PRICING_NAV: boolean = true
/** Hide SaaS legal / analytics / operator chrome for a private invite-only instance. */
export const HIDE_PUBLIC_LEGAL_NAV: boolean = true
export const EMAIL_OTP_SIGN_IN: boolean = false
/**
 * Stripe / checkout off for this private self-host. Keep false; do not enable
 * STRIPE_* secrets. When false, new upload-enabled workspaces are provisioned
 * at SELF_HOST_PLAN (Plus entitlements, including link sharing).
 */
export const BILLING_ENABLED: boolean = false
/** Plan written on workspace create when BILLING_ENABLED is false. */
export const SELF_HOST_PLAN = 'plus' as const
/**
 * Cloudflare Flagship (`FLAGS` binding). This self-host has no Flagship
 * binding; keep false so upload/maintenance do not fail closed in production.
 * Do not set APP_ENV to a non-production value as a Flagship workaround —
 * that rewrites sandbox iframe URLs to sandbox.localhost.
 */
export const FLAGSHIP_REQUIRED: boolean = false
