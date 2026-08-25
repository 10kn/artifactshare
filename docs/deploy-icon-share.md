# Icon Share operator runbook（正本）

旧ファイル名 `deploy-10kn.md` と同内容。Cloudflare Worker 名は **`icon-share`** 系。

正本 gate: `scripts/10kn-deploy-preflight.mjs` + `node --test scripts/10kn-deploy-preflight.test.mjs`。
旧 `icon-share/artifacts/deploy/` 配下の config/README は設計参考・非正本。

## 前提

- worktree: `worktrees/deploy-preflight`、branch `feat/10kn-deploy-preflight`
- [`instance.config.json`](../../../instance.config.json): `workerAppName=icon-share`、`hosts.*` 確定済み
- domain 確定済み: app `icon-share.<subdomain>.workers.dev`、sandbox `rokq.io`
- Cloudflare resource 作成済み: D1 `10kn-share-db` / R2 `10kn-share-artifacts` / KV `10kn-share-view-dedup` / KV `10kn-share-og-font`（名称 legacy、binding のみ app/sandbox 共有）

## 手順

```sh
# 0) hosts.ts literal patch（domain 変更時のみ）
#    APEX_HOST / WWW_HOST = icon-share.<SUBDOMAIN>.workers.dev
#    SANDBOX_HOST = rokq.io（bare hostname のみ）

# 1) 実config 生成（ignored apps/web/.10kn-deploy/ へ atomic 出力）
export WORKERS_SUBDOMAIN=mixmaxjam SANDBOX_HOST=rokq.io \
  D1_DATABASE_ID=<uuid> KV_VIEW_DEDUP_ID=<32hex> KV_OG_FONT_ID=<32hex>
node scripts/render-10kn-deploy-config.mjs --repo=.

# 2) preflight
node scripts/10kn-deploy-preflight.mjs --repo=.

# 3) app build
cd apps/web
WRANGLER_CONFIG_PATH=.10kn-deploy/app.json pnpm exec react-router build
cd ../..

# 4) preflight 再実行

# 5) deploy 順: OG → sandbox → app
pnpm exec wrangler deploy -c apps/web/.10kn-deploy/og-image.json --name icon-share-og-image
pnpm exec wrangler deploy -c apps/web/.10kn-deploy/sandbox.json --name icon-share-sandbox
cd apps/web && pnpm exec wrangler deploy --name icon-share   # app は -c 禁止

# 6) secrets（--name icon-share）
pnpm exec wrangler secret put BETTER_AUTH_SECRET --name icon-share
pnpm exec wrangler secret put GOOGLE_CLIENT_ID --name icon-share
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --name icon-share

# 7) smoke
curl -I https://icon-share.mixmaxjam.workers.dev/
curl -I https://rokq.io/
```

## sandbox ルート競合時

別 Worker が `*.rokq.io/*` を保持している場合、先に旧 sandbox Worker を削除してから redeploy:

```sh
pnpm exec wrangler delete <old-sandbox-worker> --force
pnpm exec wrangler deploy -c apps/web/.10kn-deploy/sandbox.json --name icon-share-sandbox
```

## 禁止

- app へ `-c` を渡さない（redirect 経由が契約）
- preflight 未通過での deploy / secret put
- 実 ID / secret を tracked file へ保存すること

継承: ORCH-NORMS 承認ゲート（社外送信・本番デプロイ・破壊的操作・workspace 横断）
