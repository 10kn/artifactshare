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
