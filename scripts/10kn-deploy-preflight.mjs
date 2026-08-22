#!/usr/bin/env node
// Fail-closed 10kn deploy preflight. Node stdlib only.
// Checks: 3 generated configs + build/server/wrangler.json + redirect + hosts.ts.
// Errors emit field codes only — never IDs, domains, or secret-like values.
//
// Required: WORKERS_SUBDOMAIN, SANDBOX_HOST, D1_DATABASE_ID,
//           KV_VIEW_DEDUP_ID, KV_OG_FONT_ID  (+ optional --repo)

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APP_NAME,
  DEPLOY_DIR,
  deriveHosts,
  parseArgs,
} from './render-10kn-deploy-config.mjs'

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
const ZERO_KV = '0'.repeat(32)
const CRONS = ['0 17 * * *', '*/5 * * * *']
const RATE_LIMITS = [
  { name: 'MCP_RATELIMIT_USER', namespace_id: '1001', limit: 120, period: 60 },
  {
    name: 'MCP_RATELIMIT_WORKSPACE',
    namespace_id: '1002',
    limit: 60,
    period: 60,
  },
  { name: 'VIEWER_RATELIMIT', namespace_id: '1003', limit: 300, period: 60 },
]

// Exact source literals that must be patched after domain decision (contract).
export const HOST_LITERAL_PATCH_TARGETS = [
  'apps/web/app/lib/hosts.ts:APEX_HOST',
  'apps/web/app/lib/hosts.ts:WWW_HOST',
  'apps/web/app/lib/hosts.ts:SANDBOX_HOST',
]

export function runPreflight(cfg) {
  const errors = []
  const fail = (code) => errors.push(code)

  if (
    !cfg.workersSubdomain ||
    !cfg.sandboxHost ||
    !cfg.d1Id ||
    !cfg.kvViewDedupId ||
    !cfg.kvOgFontId
  ) {
    return { ok: false, exitCode: 2, errors: ['missing_input'] }
  }

  const { appHost, appOrigin } = deriveHosts(cfg.workersSubdomain)
  const web = (...p) => resolve(cfg.repo, 'apps/web', ...p)
  const deploy = (...p) => resolve(cfg.repo, DEPLOY_DIR, ...p)

  const rejectBadId = (field, value) => {
    if (!value) fail(`${field}.missing`)
    else if (value === ZERO_UUID || value === ZERO_KV) fail(`${field}.zero`)
    else if (/\$\{[A-Z0-9_]+\}/.test(String(value))) fail(`${field}.placeholder`)
    else if (/PLACEHOLDER/i.test(String(value))) fail(`${field}.placeholder`)
  }

  const scanBanned = (label, text) => {
    if (/\$\{[A-Z0-9_]+\}/.test(text)) fail(`${label}.placeholder`)
    if (/PLACEHOLDER/i.test(text)) fail(`${label}.placeholder`)
    if (text.includes(ZERO_UUID) || text.includes(`"${ZERO_KV}"`))
      fail(`${label}.zero`)
    if (/artifactshare\.com/.test(text)) fail(`${label}.upstream_domain`)
    if (/artifactshare-public-preview/.test(text)) fail(`${label}.upstream_worker`)
    if (/artifactshare-sandbox/.test(text) || /artifactshare-og-image/.test(text))
      fail(`${label}.upstream_worker`)
  }

  // ---- actual generated configs (3) ------------------------------------
  let appCfg, sandboxCfg, ogCfg
  let appRaw, sandboxRaw, ogRaw
  try {
    appRaw = readFileSync(deploy('app.json'), 'utf8')
    appCfg = JSON.parse(appRaw)
  } catch {
    fail('app.config.unreadable')
  }
  try {
    sandboxRaw = readFileSync(deploy('sandbox.json'), 'utf8')
    sandboxCfg = JSON.parse(sandboxRaw)
  } catch {
    fail('sandbox.config.unreadable')
  }
  try {
    ogRaw = readFileSync(deploy('og-image.json'), 'utf8')
    ogCfg = JSON.parse(ogRaw)
  } catch {
    fail('og.config.unreadable')
  }

  if (appCfg) {
    scanBanned('app', appRaw)
    scanBanned('app.json', JSON.stringify(appCfg))
    if (appCfg.name !== APP_NAME) fail('app.name')
    if (appCfg.workers_dev !== true) fail('app.workers_dev')
    if (appCfg.vars?.BETTER_AUTH_URL !== appOrigin) fail('app.BETTER_AUTH_URL')
    const d1 = appCfg.d1_databases?.find((d) => d.binding === 'DB')
    if (!d1) fail('app.d1.missing')
    else {
      if (d1.database_name !== `${APP_NAME}-db`) fail('app.d1.database_name')
      rejectBadId('app.d1.database_id', d1.database_id)
      if (d1.database_id !== cfg.d1Id) fail('app.d1.database_id.mismatch')
    }
    const kv = appCfg.kv_namespaces?.find((k) => k.binding === 'VIEW_DEDUP')
    if (!kv) fail('app.kv.VIEW_DEDUP.missing')
    else {
      rejectBadId('app.kv.VIEW_DEDUP', kv.id)
      if (kv.id !== cfg.kvViewDedupId) fail('app.kv.VIEW_DEDUP.mismatch')
    }
    if (
      JSON.stringify(appCfg.r2_buckets) !==
      JSON.stringify([
        { binding: 'BUCKET', bucket_name: `${APP_NAME}-artifacts` },
      ])
    ) {
      fail('app.r2')
    }
    if (
      JSON.stringify(appCfg.services) !==
      JSON.stringify([
        { binding: 'OG_IMAGE_WORKER', service: `${APP_NAME}-og-image` },
      ])
    ) {
      fail('app.services.OG_IMAGE_WORKER')
    }
    if (
      JSON.stringify(appCfg.durable_objects?.bindings) !==
      JSON.stringify([{ name: 'ARTIFACT_LIVE', class_name: 'ArtifactLiveRoom' }])
    ) {
      fail('app.durable_objects')
    }
    if (
      JSON.stringify(appCfg.migrations) !==
      JSON.stringify([{ tag: 'v1', new_sqlite_classes: ['ArtifactLiveRoom'] }])
    ) {
      fail('app.migrations')
    }
    for (const rl of RATE_LIMITS) {
      const got = appCfg.ratelimits?.find((r) => r.namespace_id === rl.namespace_id)
      if (
        !got ||
        got.name !== rl.name ||
        got.simple?.limit !== rl.limit ||
        got.simple?.period !== rl.period
      ) {
        fail(`app.ratelimits.${rl.namespace_id}`)
      }
    }
    if (appCfg.ratelimits?.length !== 3) fail('app.ratelimits.count')
    if (JSON.stringify(appCfg.triggers?.crons) !== JSON.stringify(CRONS)) {
      fail('app.triggers.crons')
    }
  }

  if (sandboxCfg) {
    scanBanned('sandbox', sandboxRaw)
    scanBanned('sandbox.json', JSON.stringify(sandboxCfg))
    if (sandboxCfg.name !== `${APP_NAME}-sandbox`) fail('sandbox.name')
    const d1 = sandboxCfg.d1_databases?.find((d) => d.binding === 'DB')
    if (!d1) fail('sandbox.d1.missing')
    else {
      if (d1.database_name !== `${APP_NAME}-db`) fail('sandbox.d1.database_name')
      rejectBadId('sandbox.d1.database_id', d1.database_id)
      if (d1.database_id !== cfg.d1Id) fail('sandbox.d1.database_id.mismatch')
      if (appCfg) {
        const appD1 = appCfg.d1_databases?.find((d) => d.binding === 'DB')
        if (appD1 && d1.database_id !== appD1.database_id) {
          fail('sandbox.d1.database_id.app_mismatch')
        }
        if (appD1 && d1.database_name !== appD1.database_name) {
          fail('sandbox.d1.database_name.app_mismatch')
        }
      }
    }
    if (
      JSON.stringify(sandboxCfg.r2_buckets) !==
      JSON.stringify([
        { binding: 'BUCKET', bucket_name: `${APP_NAME}-artifacts` },
      ])
    ) {
      fail('sandbox.r2')
    }
    if (appCfg && JSON.stringify(sandboxCfg.r2_buckets) !== JSON.stringify(appCfg.r2_buckets)) {
      fail('sandbox.r2.app_mismatch')
    }
    const routes = sandboxCfg.routes ?? []
    const apex = routes.find(
      (r) => r.pattern === cfg.sandboxHost && r.custom_domain === true,
    )
    const wild = routes.find(
      (r) =>
        r.pattern === `*.${cfg.sandboxHost}/*` &&
        r.zone_name === cfg.sandboxHost,
    )
    if (!apex) fail('sandbox.routes.apex')
    if (!wild) fail('sandbox.routes.wildcard')
    if (sandboxCfg.vars?.BETTER_AUTH_URL !== appOrigin) {
      fail('sandbox.BETTER_AUTH_URL')
    }
  }

  if (ogCfg) {
    scanBanned('og', ogRaw)
    scanBanned('og.json', JSON.stringify(ogCfg))
    if (ogCfg.name !== `${APP_NAME}-og-image`) fail('og.name')
    const kv = ogCfg.kv_namespaces?.find(
      (k) => k.binding === 'SLACK_PREVIEW_FONT_KV',
    )
    if (!kv) fail('og.kv.SLACK_PREVIEW_FONT_KV.missing')
    else {
      rejectBadId('og.kv.SLACK_PREVIEW_FONT_KV', kv.id)
      // P-2: required OG KV input must match actual OG config
      if (kv.id !== cfg.kvOgFontId) fail('og.kv.SLACK_PREVIEW_FONT_KV.mismatch')
    }
  }

  // ---- build generated config + redirect --------------------------------
  let gen, genRaw
  try {
    const genPath = web('build', 'server', 'wrangler.json')
    genRaw = readFileSync(genPath, 'utf8')
    gen = JSON.parse(genRaw)
  } catch {
    fail('build.wrangler.unreadable')
  }

  const approvedApp = deploy('app.json')
  if (gen) {
    scanBanned('build', genRaw)
    scanBanned('build.json', JSON.stringify(gen))
    for (const key of ['configPath', 'userConfigPath']) {
      try {
        if (resolve(String(gen[key])) !== approvedApp) fail(`build.${key}`)
      } catch {
        fail(`build.${key}`)
      }
    }
    if (gen.name !== APP_NAME) fail('build.name')
    if (gen.topLevelName != null && gen.topLevelName !== APP_NAME) {
      fail('build.topLevelName')
    }
    if (gen.vars?.BETTER_AUTH_URL !== appOrigin) fail('build.BETTER_AUTH_URL')
    const d1 = gen.d1_databases?.find((d) => d.binding === 'DB')
    if (!d1 || d1.database_id !== cfg.d1Id) fail('build.d1.database_id')
    if (d1 && d1.database_name !== `${APP_NAME}-db`) fail('build.d1.database_name')
    const kv = gen.kv_namespaces?.find((k) => k.binding === 'VIEW_DEDUP')
    if (!kv || kv.id !== cfg.kvViewDedupId) fail('build.kv.VIEW_DEDUP')
    if (
      JSON.stringify(gen.r2_buckets) !==
      JSON.stringify([
        { binding: 'BUCKET', bucket_name: `${APP_NAME}-artifacts` },
      ])
    ) {
      fail('build.r2')
    }
    if (
      JSON.stringify(gen.services) !==
      JSON.stringify([
        { binding: 'OG_IMAGE_WORKER', service: `${APP_NAME}-og-image` },
      ])
    ) {
      fail('build.services')
    }
    if (
      JSON.stringify(gen.durable_objects?.bindings) !==
      JSON.stringify([{ name: 'ARTIFACT_LIVE', class_name: 'ArtifactLiveRoom' }])
    ) {
      fail('build.durable_objects')
    }
    if (
      JSON.stringify(gen.migrations) !==
      JSON.stringify([{ tag: 'v1', new_sqlite_classes: ['ArtifactLiveRoom'] }])
    ) {
      fail('build.migrations')
    }
    if (JSON.stringify(gen.triggers?.crons) !== JSON.stringify(CRONS)) {
      fail('build.triggers.crons')
    }
    for (const rl of RATE_LIMITS) {
      const got = gen.ratelimits?.find((r) => r.namespace_id === rl.namespace_id)
      if (
        !got ||
        got.name !== rl.name ||
        got.simple?.limit !== rl.limit ||
        got.simple?.period !== rl.period
      ) {
        fail(`build.ratelimits.${rl.namespace_id}`)
      }
    }
  }

  try {
    const redirect = JSON.parse(
      readFileSync(web('.wrangler', 'deploy', 'config.json'), 'utf8'),
    )
    if (
      resolve(web('.wrangler', 'deploy', redirect.configPath)) !==
      web('build', 'server', 'wrangler.json')
    ) {
      fail('redirect.configPath')
    }
  } catch {
    fail('redirect.unreadable')
  }

  // ---- source host literals (bare hostname contract = P-1) --------------
  let hosts
  try {
    hosts = readFileSync(web('app', 'lib', 'hosts.ts'), 'utf8')
  } catch {
    return { ok: false, exitCode: 1, errors: [...errors, 'hosts.unreadable'] }
  }

  const constRe = (name) => new RegExp(`export const ${name} = '([^']*)'`)
  const apex = hosts.match(constRe('APEX_HOST'))?.[1]
  const www = hosts.match(constRe('WWW_HOST'))?.[1]
  const sbx = hosts.match(constRe('SANDBOX_HOST'))?.[1]

  // P-1: scheme in source constant is RED (would produce https://https:// CSP)
  for (const [name, value] of [
    ['APEX_HOST', apex],
    ['WWW_HOST', www],
    ['SANDBOX_HOST', sbx],
  ]) {
    if (value == null) fail(`hosts.${name}.missing`)
    else if (/^https?:\/\//i.test(value) || value.includes('/')) {
      fail(`hosts.${name}.scheme_forbidden`)
    }
  }
  if (apex !== appHost) fail('hosts.APEX_HOST.mismatch')
  if (www !== appHost) fail('hosts.WWW_HOST.mismatch')
  if (sbx !== cfg.sandboxHost) fail('hosts.SANDBOX_HOST.mismatch')
  if (/artifactshare\.com/.test(hosts)) fail('hosts.upstream_domain')

  for (const rel of ['workers/sandbox.ts', 'workers/bundle-sandbox.ts']) {
    let t
    try {
      t = readFileSync(web(rel), 'utf8')
    } catch {
      fail(`source.${rel}.unreadable`)
      continue
    }
    if (/artifactshare\.com/.test(t)) fail(`source.${rel}.upstream_domain`)
  }

  {
    let t
    try {
      t = readFileSync(web('workers', 'bundle-sandbox.ts'), 'utf8')
      if (
        !/from ['"]\.\.\/app\/lib\/hosts['"]/.test(t) &&
        !(t.includes(appHost) && t.includes(cfg.sandboxHost))
      ) {
        fail('source.bundle-sandbox.hosts_ref')
      }
    } catch {
      fail('source.bundle-sandbox.unreadable')
    }
  }

  // unused required input guard: every input must have produced a match above
  // (WORKERS_SUBDOMAIN→appHost/origin, SANDBOX_HOST→routes+hosts,
  //  D1/VIEW_DEDUP/OG→config id checks). If we reach here with empty errors
  // and inputs present, they were used.
  void appHost

  if (errors.length) return { ok: false, exitCode: 1, errors, appHost, appOrigin }
  return { ok: true, exitCode: 0, errors: [], appHost, appOrigin }
}

function isMain() {
  const self = fileURLToPath(import.meta.url)
  const entry = process.argv[1] ? resolve(process.argv[1]) : ''
  return entry === self
}

if (isMain()) {
  const cfg = parseArgs()
  const result = runPreflight(cfg)
  if (!result.ok) {
    console.error(`PREFLIGHT FAIL (${result.errors.length}):`)
    for (const code of result.errors) console.error(`  - ${code}`)
    process.exit(result.exitCode)
  }
  // No host/ID values in success line either (M-5 / contract 4).
  console.log('PREFLIGHT OK')
}
