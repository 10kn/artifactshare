import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  APP_NAME,
  DEPLOY_DIR,
  RESOURCE_PREFIX,
  TEMPLATE_DIR,
  atomicWriteJson,
  deriveHosts,
  renderDeployConfig,
} from './render-10kn-deploy-config.mjs'
import {
  HOST_LITERAL_PATCH_TARGETS,
  runPreflight,
} from './10kn-deploy-preflight.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REAL_REPO = resolve(HERE, '..')

const DUMMY = {
  workersSubdomain: 'dummy-subdomain',
  sandboxHost: 'dummy-sandbox.example',
  d1Id: '11111111-2222-4333-8444-555555555555',
  kvViewDedupId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  kvOgFontId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
}

function tempRepo(tag) {
  const root = mkdtempSync(join(tmpdir(), `10kn-preflight-${tag}-`))
  return root
}

function copyTemplates(repo) {
  const dest = join(repo, TEMPLATE_DIR)
  mkdirSync(dest, { recursive: true })
  for (const name of [
    'app.template.json',
    'sandbox.template.json',
    'og-image.template.json',
  ]) {
    writeFileSync(
      join(dest, name),
      readFileSync(join(REAL_REPO, TEMPLATE_DIR, name)),
    )
  }
}

function writeHosts(repo, { apex, www, sandbox }) {
  const path = join(repo, 'apps/web/app/lib/hosts.ts')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    [
      `export const APEX_HOST = '${apex}'`,
      `export const WWW_HOST = '${www}'`,
      `export const SANDBOX_HOST = '${sandbox}'`,
      '',
    ].join('\n'),
  )
}

function writeWorkerStubs(repo) {
  for (const rel of ['workers/sandbox.ts', 'workers/bundle-sandbox.ts']) {
    const path = join(repo, 'apps/web', rel)
    mkdirSync(dirname(path), { recursive: true })
    const body =
      rel.endsWith('bundle-sandbox.ts')
        ? `import { APEX_HOST, WWW_HOST } from '../app/lib/hosts'\nexport const x = APEX_HOST\n`
        : `import { SANDBOX_HOST } from '../app/lib/hosts'\nexport const x = SANDBOX_HOST\n`
    writeFileSync(path, body)
  }
}

function writeBuildAndRedirect(repo, appConfigPath, overrides = {}) {
  const { appHost, appOrigin } = deriveHosts(DUMMY.workersSubdomain)
  const buildDir = join(repo, 'apps/web/build/server')
  mkdirSync(buildDir, { recursive: true })
  const gen = {
    configPath: appConfigPath,
    userConfigPath: appConfigPath,
    name: APP_NAME,
    topLevelName: APP_NAME,
    vars: { BETTER_AUTH_URL: appOrigin },
    d1_databases: [
      {
        binding: 'DB',
        database_name: `${RESOURCE_PREFIX}-db`,
        database_id: DUMMY.d1Id,
      },
    ],
    kv_namespaces: [{ binding: 'VIEW_DEDUP', id: DUMMY.kvViewDedupId }],
    r2_buckets: [
      { binding: 'BUCKET', bucket_name: `${RESOURCE_PREFIX}-artifacts` },
    ],
    services: [
      { binding: 'OG_IMAGE_WORKER', service: `${APP_NAME}-og-image` },
    ],
    durable_objects: {
      bindings: [{ name: 'ARTIFACT_LIVE', class_name: 'ArtifactLiveRoom' }],
    },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['ArtifactLiveRoom'] }],
    ratelimits: [
      {
        name: 'MCP_RATELIMIT_USER',
        namespace_id: '1001',
        simple: { limit: 120, period: 60 },
      },
      {
        name: 'MCP_RATELIMIT_WORKSPACE',
        namespace_id: '1002',
        simple: { limit: 60, period: 60 },
      },
      {
        name: 'VIEWER_RATELIMIT',
        namespace_id: '1003',
        simple: { limit: 300, period: 60 },
      },
    ],
    triggers: { crons: ['0 17 * * *', '*/5 * * * *'] },
    ...overrides,
  }
  writeFileSync(join(buildDir, 'wrangler.json'), `${JSON.stringify(gen, null, 2)}\n`)
  const redirectDir = join(repo, 'apps/web/.wrangler/deploy')
  mkdirSync(redirectDir, { recursive: true })
  writeFileSync(
    join(redirectDir, 'config.json'),
    `${JSON.stringify({ configPath: '../../build/server/wrangler.json', auxiliaryWorkers: [] })}\n`,
  )
  return { appHost, appOrigin }
}

function greenFixture() {
  const repo = tempRepo('green')
  copyTemplates(repo)
  const { appHost } = deriveHosts(DUMMY.workersSubdomain)
  writeHosts(repo, {
    apex: appHost,
    www: appHost,
    sandbox: DUMMY.sandboxHost,
  })
  writeWorkerStubs(repo)
  const rendered = renderDeployConfig({ repo, ...DUMMY })
  writeBuildAndRedirect(repo, rendered.written[0])
  return { repo, appHost, rendered }
}

function runCli(script, args, env = {}) {
  return spawnSync(process.execPath, [join(HERE, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

function assertNoSecretsInOutput(text) {
  for (const v of Object.values(DUMMY)) {
    assert.equal(
      text.includes(v),
      false,
      `output must not contain dummy value ${v}`,
    )
  }
  assert.equal(text.includes('https://'), false)
  assert.equal(text.includes('dummy-sandbox'), false)
  assert.equal(text.includes('dummy-subdomain'), false)
}

test('HOST_LITERAL_PATCH_TARGETS documents post-domain source patches', () => {
  assert.deepEqual(HOST_LITERAL_PATCH_TARGETS, [
    'apps/web/app/lib/hosts.ts:APEX_HOST',
    'apps/web/app/lib/hosts.ts:WWW_HOST',
    'apps/web/app/lib/hosts.ts:SANDBOX_HOST',
  ])
})

test('GREEN: bare APP_HOST/SANDBOX_HOST + 3config/build/redirect/source match', () => {
  const { repo } = greenFixture()
  try {
    const result = runPreflight({ repo, ...DUMMY })
    assert.equal(result.ok, true)
    assert.equal(result.exitCode, 0)
    assert.deepEqual(result.errors, [])
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('P-1 RED: APEX_HOST with https:// scheme exits non-zero', () => {
  const { repo, appHost } = greenFixture()
  try {
    writeHosts(repo, {
      apex: `https://${appHost}`,
      www: appHost,
      sandbox: DUMMY.sandboxHost,
    })
    const result = runPreflight({ repo, ...DUMMY })
    assert.equal(result.ok, false)
    assert.notEqual(result.exitCode, 0)
    assert.ok(result.errors.includes('hosts.APEX_HOST.scheme_forbidden'))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('P-1 RED: WWW_HOST with https:// scheme exits non-zero', () => {
  const { repo, appHost } = greenFixture()
  try {
    writeHosts(repo, {
      apex: appHost,
      www: `https://${appHost}`,
      sandbox: DUMMY.sandboxHost,
    })
    const result = runPreflight({ repo, ...DUMMY })
    assert.equal(result.ok, false)
    assert.ok(result.errors.includes('hosts.WWW_HOST.scheme_forbidden'))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('P-2 RED: OG KV ID mismatch', () => {
  const { repo } = greenFixture()
  try {
    const ogPath = join(repo, DEPLOY_DIR, 'og-image.json')
    const og = JSON.parse(readFileSync(ogPath, 'utf8'))
    og.kv_namespaces[0].id = 'cccccccccccccccccccccccccccccccc'
    writeFileSync(ogPath, `${JSON.stringify(og, null, 2)}\n`)
    const result = runPreflight({ repo, ...DUMMY })
    assert.equal(result.ok, false)
    assert.ok(result.errors.includes('og.kv.SLACK_PREVIEW_FONT_KV.mismatch'))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('P-2 RED: sandbox D1 mismatch', () => {
  const { repo } = greenFixture()
  try {
    const path = join(repo, DEPLOY_DIR, 'sandbox.json')
    const cfg = JSON.parse(readFileSync(path, 'utf8'))
    cfg.d1_databases[0].database_id = '99999999-9999-4999-8999-999999999999'
    writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`)
    const result = runPreflight({ repo, ...DUMMY })
    assert.equal(result.ok, false)
    assert.ok(
      result.errors.includes('sandbox.d1.database_id.mismatch') ||
        result.errors.includes('sandbox.d1.database_id.app_mismatch'),
    )
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('P-2 RED: sandbox apex route mismatch', () => {
  const { repo } = greenFixture()
  try {
    const path = join(repo, DEPLOY_DIR, 'sandbox.json')
    const cfg = JSON.parse(readFileSync(path, 'utf8'))
    cfg.routes[0].pattern = 'wrong-apex.example'
    writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`)
    const result = runPreflight({ repo, ...DUMMY })
    assert.equal(result.ok, false)
    assert.ok(result.errors.includes('sandbox.routes.apex'))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('P-2 RED: sandbox wildcard route mismatch', () => {
  const { repo } = greenFixture()
  try {
    const path = join(repo, DEPLOY_DIR, 'sandbox.json')
    const cfg = JSON.parse(readFileSync(path, 'utf8'))
    cfg.routes[1].pattern = '*.wrong.example/*'
    writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`)
    const result = runPreflight({ repo, ...DUMMY })
    assert.equal(result.ok, false)
    assert.ok(result.errors.includes('sandbox.routes.wildcard'))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('RED: placeholder / zero / wrong Worker name', () => {
  const { repo } = greenFixture()
  try {
    const appPath = join(repo, DEPLOY_DIR, 'app.json')
    const app = JSON.parse(readFileSync(appPath, 'utf8'))
    app.d1_databases[0].database_id = '00000000-0000-0000-0000-000000000000'
    app.name = 'artifactshare'
    writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`)

    const ogPath = join(repo, DEPLOY_DIR, 'og-image.json')
    const og = JSON.parse(readFileSync(ogPath, 'utf8'))
    og.kv_namespaces[0].id = '${KV_OG_FONT_ID}'
    writeFileSync(ogPath, `${JSON.stringify(og, null, 2)}\n`)

    const result = runPreflight({ repo, ...DUMMY })
    assert.equal(result.ok, false)
    assert.ok(result.errors.includes('app.d1.database_id.zero'))
    assert.ok(result.errors.includes('app.name'))
    assert.ok(
      result.errors.some(
        (e) => e.includes('og') && e.includes('placeholder'),
      ),
    )
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('CLI error output never leaks dummy IDs/domains', () => {
  const { repo, appHost } = greenFixture()
  try {
    writeHosts(repo, {
      apex: `https://${appHost}`,
      www: appHost,
      sandbox: DUMMY.sandboxHost,
    })
    const proc = runCli('10kn-deploy-preflight.mjs', [
      `--repo=${repo}`,
      `--workers-subdomain=${DUMMY.workersSubdomain}`,
      `--sandbox-host=${DUMMY.sandboxHost}`,
      `--d1-id=${DUMMY.d1Id}`,
      `--kv-view-dedup-id=${DUMMY.kvViewDedupId}`,
      `--kv-og-font-id=${DUMMY.kvOgFontId}`,
    ])
    assert.notEqual(proc.status, 0)
    assertNoSecretsInOutput(`${proc.stdout}\n${proc.stderr}`)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('generator success/failure leaves zero temp files', () => {
  const repo = tempRepo('render-tmp')
  try {
    copyTemplates(repo)
    renderDeployConfig({ repo, ...DUMMY })
    const outDir = join(repo, DEPLOY_DIR)
    const leftovers = readdirSync(outDir).filter((n) => n.includes('.tmp'))
    assert.deepEqual(leftovers, [])

    // force failure mid-write via broken substitute path: corrupt template
    writeFileSync(
      join(repo, TEMPLATE_DIR, 'app.template.json'),
      '{ "name": "${UNRESOLVED_TOKEN}" }\n',
    )
    assert.throws(() => renderDeployConfig({ repo, ...DUMMY }))
    const afterFail = existsSync(outDir)
      ? readdirSync(outDir).filter((n) => n.includes('.tmp'))
      : []
    assert.deepEqual(afterFail, [])
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('atomicWriteJson cleans temp on rename failure path', () => {
  const dir = tempRepo('atomic')
  try {
    const target = join(dir, 'out.json')
    // write once ok
    atomicWriteJson(target, '{"ok":true}\n')
    assert.equal(readFileSync(target, 'utf8'), '{"ok":true}\n')
    const tmps = readdirSync(dir).filter((n) => n.includes('.tmp'))
    assert.deepEqual(tmps, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('missing required input is fail-closed (exit 2)', () => {
  const { repo } = greenFixture()
  try {
    const result = runPreflight({
      repo,
      workersSubdomain: DUMMY.workersSubdomain,
      sandboxHost: DUMMY.sandboxHost,
      d1Id: DUMMY.d1Id,
      kvViewDedupId: DUMMY.kvViewDedupId,
      kvOgFontId: '',
    })
    assert.equal(result.ok, false)
    assert.equal(result.exitCode, 2)
    assert.deepEqual(result.errors, ['missing_input'])
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('actual worktree hosts.ts uses icon-share production literals', () => {
  const hosts = readFileSync(
    join(REAL_REPO, 'apps/web/app/lib/hosts.ts'),
    'utf8',
  )
  assert.match(hosts, /icon-share\.mixmaxjam\.workers\.dev/)
  assert.match(hosts, /rokq\.io/)
  assert.doesNotMatch(hosts, /10kn-share\.mixmaxjam\.workers\.dev/)
})
