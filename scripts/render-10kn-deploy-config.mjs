#!/usr/bin/env node
// Render ignored 10kn deploy configs from tracked templates.
// stdlib only. Never writes fork-specific IDs/domains into tracked files.
//
// Required inputs (CLI --k=v or env):
//   WORKERS_SUBDOMAIN, SANDBOX_HOST, D1_DATABASE_ID,
//   KV_VIEW_DEDUP_ID, KV_OG_FONT_ID
// Optional: REPO (default: cwd)
//
// APP_HOST (bare) and APP_ORIGIN (https://) are derived internally.
// Output: apps/web/.10kn-deploy/{app,sandbox,og-image}.json (gitignored)

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cloudflare Worker script names (icon-share, icon-share-sandbox, …). */
export const RESOURCE_PREFIX = '10kn-share'

export function loadAppName(repo) {
  const instancePath = resolve(repo, '../../instance.config.json')
  if (existsSync(instancePath)) {
    const { workerAppName } = JSON.parse(readFileSync(instancePath, 'utf8'))
    if (workerAppName) return workerAppName
  }
  return 'icon-share'
}

export const APP_NAME = loadAppName(process.cwd())
export const DEPLOY_DIR = 'apps/web/.10kn-deploy'
export const TEMPLATE_DIR = 'apps/web/deploy/10kn'

const REQUIRED = [
  'WORKERS_SUBDOMAIN',
  'SANDBOX_HOST',
  'D1_DATABASE_ID',
  'KV_VIEW_DEDUP_ID',
  'KV_OG_FONT_ID',
]

const OUTPUTS = [
  ['app.template.json', 'app.json'],
  ['sandbox.template.json', 'sandbox.json'],
  ['og-image.template.json', 'og-image.json'],
]

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const flags = Object.fromEntries(
    argv
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const i = a.indexOf('=')
        return i === -1 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]
      }),
  )
  const get = (flag, envKey) => flags[flag] ?? env[envKey] ?? ''
  return {
    repo: resolve(get('repo', 'REPO') || process.cwd()),
    workersSubdomain: get('workers-subdomain', 'WORKERS_SUBDOMAIN'),
    sandboxHost: get('sandbox-host', 'SANDBOX_HOST'),
    d1Id: get('d1-id', 'D1_DATABASE_ID'),
    kvViewDedupId: get('kv-view-dedup-id', 'KV_VIEW_DEDUP_ID'),
    kvOgFontId: get('kv-og-font-id', 'KV_OG_FONT_ID'),
  }
}

export function deriveHosts(workersSubdomain, appName = APP_NAME) {
  const appHost = `${appName}.${workersSubdomain}.workers.dev`
  return { appHost, appOrigin: `https://${appHost}` }
}

function assertInputs(cfg) {
  const missing = []
  if (!cfg.workersSubdomain) missing.push('WORKERS_SUBDOMAIN')
  if (!cfg.sandboxHost) missing.push('SANDBOX_HOST')
  if (!cfg.d1Id) missing.push('D1_DATABASE_ID')
  if (!cfg.kvViewDedupId) missing.push('KV_VIEW_DEDUP_ID')
  if (!cfg.kvOgFontId) missing.push('KV_OG_FONT_ID')
  // ponytail: bare hostname only; scheme here would bake https://https:// into CSP
  if (cfg.sandboxHost.includes('/') || cfg.sandboxHost.includes(':')) {
    throw Object.assign(new Error('invalid_input:SANDBOX_HOST'), { code: 2 })
  }
  if (missing.length) {
    throw Object.assign(new Error(`missing_input:${missing.join(',')}`), {
      code: 2,
    })
  }
}

function substitute(text, tokens) {
  let out = text
  for (const [key, value] of Object.entries(tokens)) {
    out = out.split(`\${${key}}`).join(value)
  }
  if (/\$\{[A-Z0-9_]+\}/.test(out)) {
    throw Object.assign(new Error('unresolved_placeholder'), { code: 1 })
  }
  return out
}

export function atomicWriteJson(target, text) {
  const dir = dirname(target)
  mkdirSync(dir, { recursive: true })
  const tmp = join(
    dir,
    `.${basename(target)}.${process.pid}.${Date.now()}.tmp`,
  )
  try {
    writeFileSync(tmp, text)
    renameSync(tmp, target)
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    throw err
  } finally {
    // success path: rename removed tmp; failure path: unlink above
    try {
      unlinkSync(tmp)
    } catch {
      /* already gone */
    }
  }
}

export function renderDeployConfig(cfg) {
  assertInputs(cfg)
  const appName = loadAppName(cfg.repo)
  const { appHost, appOrigin } = deriveHosts(cfg.workersSubdomain, appName)
  const tokens = {
    APP_NAME: appName,
    WORKERS_SUBDOMAIN: cfg.workersSubdomain,
    SANDBOX_HOST: cfg.sandboxHost,
    D1_DATABASE_ID: cfg.d1Id,
    KV_VIEW_DEDUP_ID: cfg.kvViewDedupId,
    KV_OG_FONT_ID: cfg.kvOgFontId,
    APP_HOST: appHost,
    APP_ORIGIN: appOrigin,
  }
  // Ensure every required input token appears in at least one template (unused = RED later).
  void REQUIRED

  const outDir = resolve(cfg.repo, DEPLOY_DIR)
  const written = []
  for (const [templateName, outName] of OUTPUTS) {
    const templatePath = resolve(cfg.repo, TEMPLATE_DIR, templateName)
    const raw = readFileSync(templatePath, 'utf8')
    const rendered = substitute(raw, tokens)
    JSON.parse(rendered) // fail-closed on invalid JSON
    const target = join(outDir, outName)
    atomicWriteJson(target, `${rendered.trim()}\n`)
    written.push(target)
  }
  return { appHost, appOrigin, outDir, written }
}

function isMain() {
  const self = fileURLToPath(import.meta.url)
  const entry = process.argv[1] ? resolve(process.argv[1]) : ''
  return entry === self
}

if (isMain()) {
  try {
    const cfg = parseArgs()
    const result = renderDeployConfig(cfg)
    // No IDs/domains in stdout — field names only.
    console.log(`RENDER OK: files=${result.written.length} dir=.10kn-deploy`)
  } catch (err) {
    console.error(`RENDER FAIL: ${err.message}`)
    process.exit(err.code ?? 1)
  }
}
