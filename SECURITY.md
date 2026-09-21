# セキュリティと依存関係の更新

このアプリは利用者の端末で動かすローカルアプリです。AI の認証情報、書籍本文、会話履歴、個人情報を Issue や Pull Request に添付しないでください。

## 導入済みの対策

| 対策 | 設定・運用 |
| --- | --- |
| パッケージマネージャーの固定 | `package.json` の `packageManager` に pnpm 11.27.0 と SHA-512 を指定。Corepack 経由で取得・実行し、異なる pnpm バージョンは拒否。 |
| 再現可能な依存解決 | 直接依存は完全なバージョン指定。`pnpm-lock.yaml` を管理し、CI と通常のセットアップでは `--frozen-lockfile` を使用。 |
| 新規公開版の待機 | `minimumReleaseAge: 10080`（7日）。期限内の版へのフォールバックと、公開日時がない版の受け入れを禁止。 |
| ロックファイルの再検査 | `trustLockfile: false`。ロック済みの依存にも公開日・配布の信頼性ポリシーを適用。 |
| 信頼性低下の検知 | `trustPolicy: no-downgrade`。以前のリリースより公開元の証明が弱くなった版を拒否。証明のない全パッケージを禁止する設定ではありません。 |
| 配布元の制限 | `blockExoticSubdeps: true`。間接依存の Git・直接 tarball URL などを制限。直接依存の追加では配布元もレビュー。 |
| インストールスクリプトの制限 | `strictDepBuilds: true`。許可した依存スクリプトはゼロ。`esbuild` と `fsevents` は明示的に拒否。ビルド済みの副作用キャッシュも無効。 |
| 配布物・既知の脆弱性の検査 | CI で `pnpm audit signatures` と `pnpm audit --audit-level=high` を実行。検査サービスのエラーを成功扱いにしません。 |
| CI の権限と固定 | Actions は完全なコミット SHA、権限は `contents: read`、checkout の認証情報保存は無効。PR のコードを `pull_request_target` で実行しません。 |
| 継続的な更新 | Dependabot が pnpm 依存と Actions の更新 PR を週1回提案。通常の更新は7日待機し、人が差分と CI を確認してマージ。 |

`esbuild` は npm で配布されるプラットフォーム別の optional dependency のバイナリーを使用するため、この構成では postinstall を実行しません。optional dependencies を省略してインストールしないでください。

## 依存を追加・更新するとき

1. パッケージ名、公式リポジトリ、公開者、変更内容、ライセンスを確認します。新しい `preinstall` / `install` / `postinstall`、`binding.gyp`、依存の追加にも注意します。
2. `pnpm add -E <package>@<version>`（開発用は `-D` も指定）で個別に更新します。既存のロックファイルを削除して全体を更新する方法は避けます。
3. `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` の差分を確認し、意図しない配布元・依存・ポリシー緩和がないか見ます。
4. 以下を実行します。

```sh
pnpm install --frozen-lockfile
pnpm audit signatures
pnpm audit --audit-level=high
pnpm run check
pnpm test
pnpm run build
```

インストールが未審査のビルドで止まったときは、スクリプトを読まずに `pnpm approve-builds` で一括許可しないでください。不要なら `allowBuilds` でそのパッケージを `false` にします。どうしても必要な場合だけ、対象バージョンと理由をレビューして限定的な許可を加えます。

緊急のセキュリティ修正は7日待機より優先すべき場合があります。その場合も、修正内容を確認した特定の `package@version` のみを `minimumReleaseAgeExclude` に指定し、理由を PR に記載します。全体の待機期間や信頼性検査を無効にしません。Dependabot のセキュリティ更新は通常更新の cooldown 対象外ですが、pnpm 側のポリシーは CI で引き続き適用されます。

pnpm 自体を更新する場合は、公開日・変更内容・公式配布情報を確認し、`packageManager` のバージョンとハッシュ、`engines.pnpm` を一緒に更新します。Actions の更新では、SHA が公式リポジトリの意図したリリースを指すことを確認します。

## 公開後の GitHub 設定

このファイルだけでは GitHub のブランチ保護は有効になりません。リポジトリ作成後、`main` の ruleset で PR と CI の `check` 成功を必須にし、強制 push を制限してください。Dependabot alerts と secret scanning / push protection も確認してください。共同開発では依存ポリシーと workflow の変更を特に確認します。

## 対策の限界

待機期間・署名・ハッシュ・脆弱性データベースは、正規公開者が混入させた悪意あるコードや未報告の問題をすべて検出できません。インストールスクリプトを禁止しても、テスト・ビルド・アプリ実行時には依存コードが動きます。依存や workflow を変更する PR のレビューは引き続き必要です。

参考：[pnpm のサプライチェーン対策](https://pnpm.io/supply-chain-security)、[依存解決設定](https://pnpm.io/settings/dependency-resolution)、[ビルド設定](https://pnpm.io/settings/build)、[Dependabot 設定](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)。
