#!/usr/bin/env node
// Attach Workers custom domain `*.${SANDBOX_HOST}` for the sandbox Worker.
//
// Wrangler routes `*.host/*` + zone_name do NOT create DNS. Apex
// `custom_domain: true` does. Wrangler also rejects `*.host` as custom_domain
// in config, and `wrangler deploy` drops a previously attached `*.host`
// Workers domain that is not listed in the config.
//
// Call this AFTER every sandbox deploy:
//   SANDBOX_HOST=rokq.io SANDBOX_WORKER=icon-share-sandbox \
//     node scripts/10kn-attach-sandbox-wildcard-domain.mjs
//
// Auth: CLOUDFLARE_API_TOKEN, or wrangler OAuth token in
// ~/Library/Preferences/.wrangler/config/default.toml

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const sandboxHost = (process.env.SANDBOX_HOST ?? '').trim()
const workerName = (process.env.SANDBOX_WORKER ?? 'icon-share-sandbox').trim()
const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim()

if (!sandboxHost || sandboxHost.includes('/') || sandboxHost.includes(':')) {
  console.error('missing_or_invalid:SANDBOX_HOST')
  process.exit(2)
}

function loadToken() {
  const fromEnv = (process.env.CLOUDFLARE_API_TOKEN ?? '').trim()
  if (fromEnv) return fromEnv
  const toml = readFileSync(
    join(homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
    'utf8',
  )
  const match = /oauth_token\s*=\s*"([^"]+)"/.exec(toml)
  if (!match) {
    console.error('missing_auth:CLOUDFLARE_API_TOKEN_or_wrangler_oauth')
    process.exit(2)
  }
  return match[1]
}

async function cf(token, path, init) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const body = await response.json()
  if (!body.success) {
    const code = body.errors?.[0]?.code ?? response.status
    const message = body.errors?.[0]?.message ?? response.statusText
    throw new Error(`cf_api_error:${code}:${message}`)
  }
  return body.result
}

const token = loadToken()
const accounts = accountId
  ? [{ id: accountId }]
  : await cf(token, '/accounts?per_page=50')
if (!accounts?.length) {
  console.error('no_accounts')
  process.exit(1)
}

let attached = null
let lastError = null
for (const account of accounts) {
  try {
    const zones = await cf(
      token,
      `/zones?name=${encodeURIComponent(sandboxHost)}&account.id=${account.id}`,
    )
    const zone = zones?.[0]
    if (!zone) continue
    attached = await cf(token, `/accounts/${account.id}/workers/domains`, {
      method: 'PUT',
      body: JSON.stringify({
        hostname: `*.${sandboxHost}`,
        service: workerName,
        zone_id: zone.id,
        environment: 'production',
      }),
    })
    break
  } catch (error) {
    lastError = error
  }
}

if (!attached) {
  console.error(String(lastError ?? 'zone_or_attach_failed'))
  process.exit(1)
}

console.log(
  `ATTACHED_OK hostname=${attached.hostname} service=${attached.service} id=${attached.id}`,
)
