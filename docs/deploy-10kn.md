# 10kn-share operator runbook（正本）

正本 gate: `scripts/10kn-deploy-preflight.mjs` + `node --test scripts/10kn-deploy-preflight.test.mjs`。
旧 `10kn-share/artifacts/deploy/` 配下の config/README は設計参考・非正本。

## 前提

- worktree: `worktrees/deploy-preflight`、branch `feat/10kn-deploy-preflight`
- domain 確定済みであること（`SANDBOX_HOST` は Universal SSL が直接 cover する専用 zone apex を推奨。既存 zone の2段 host は Total TLS/ACM 等の明示証明書が必須）
- Cloudflare resource 作成済み: D1 `10kn-share-db` / R2 `10kn-share-artifacts` / KV `10kn-share-view-dedup` / KV `10kn-share-og-font`

## 手順

```sh
# 0) hosts.ts literal patch（domain 確定後、1回のみ）
#    HOST_LITERAL_PATCH_TARGETS（preflight.mjs 内）を参照。bare hostname のみ、scheme は書かない。

# 1) 実config 生成（値は tracked file に入らない。ignored apps/web/.10kn-deploy/ へ atomic 出力）
node scripts/render-10kn-deploy-config.mjs \
  --app-host=<APP_HOST> --workers-subdomain=<SUBDOMAIN> \
  --sandbox-host=<SANDBOX_HOST> \
  --d1-id=<uuid> --kv-view-dedup-id=<32hex> --kv-og-font-id=<32hex>

# 2) preflight（fail-closed。exit 0 まで次へ進まない。secret 値は出力されない）
node scripts/10kn-deploy-preflight.mjs --repo=. --app-host=... （同上の入力）

# 3) app build（生成 config を WRANGLER_CONFIG_PATH で明示。build 後に redirect が張られる）
cd apps/web
WRANGLER_CONFIG_PATH=.10kn-deploy/app.json pnpm exec react-router build
cd ../..

# 4) preflight 再実行（生成 build/config/redirect/host literals を一括検査。RED なら停止）

# 5) deploy 順: OG → sandbox → app。sandbox/OG のみ -c 直指定可
pnpm exec wrangler deploy -c apps/web/.10kn-deploy/og-image.json --name 10kn-share-og-image
pnpm exec wrangler deploy -c apps/web/.10kn-deploy/sandbox.json --name 10kn-share-sandbox
pnpm exec wrangler deploy --name 10kn-share        # app は -c 禁止（redirect 経由が契約）

# 6) secrets（各 put の直前に preflight exit 0 を再確認。必ず --name 10kn-share）
pnpm exec wrangler secret put BETTER_AUTH_SECRET --name 10kn-share
pnpm exec wrangler secret put GOOGLE_CLIENT_ID --name 10kn-share
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --name 10kn-share

# 7) DNS / 証明書 acceptance
#    wildcard route 用 proxied DNS record は Wrangler が作らない。dig で解決確認後、
#    curl -I https://<SANDBOX_HOST>/ と https://<label>.<SANDBOX_HOST>/ の HTTPS smoke を通す。

# 8) rollback
#    Worker: pnpm exec wrangler rollback [version-id] -c <config>
#    DO migration は forward-only。D1 は point-in-time restore。
```

## 禁止

- resource create / secret put / deploy / DNS 変更は HQ GO があるまで実行しない
- app へ `-c` を渡さない（deployment contract test が禁止を assert）
- preflight 未通過での deploy/secret put
- 実 ID/domain/secret を tracked file へ保存すること

継承: ORCH-NORMS 承認ゲート4種（社外送信・本番デプロイ・破壊的操作・workspace 横断）は本 runbook でも不変。
