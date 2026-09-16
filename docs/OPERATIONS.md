# Sky Rush 運用手順

この文書は、Sky Rush をローカル確認、手動デプロイ、運用確認するための手順です。GitHub Actions 自動デプロイは現時点では対象外です。

- 対象バージョン: v1.1
- 更新日: 2026-09-16

## 1. リリース前チェックリスト

コード変更後は、以下を順番に実行します。

```powershell
npm.cmd run check:stages
npm.cmd run typecheck
npm.cmd run lint
npx.cmd tsc -p tsconfig.server.json
npm.cmd run build
npm.cmd run test:host-controls
```

期待する状態:

- `Stage layout check passed.`
- フロントとサーバーのTypeScriptエラーがない
- ESLintの警告・エラーがない
- `next build` が成功する
- `Host control integration test passed.`
- webpack cache の warning は、ビルド成功とは別扱いです
- ビルド環境からGoogle Fontsへ接続できない場合、`Failed to download the stylesheet`の警告が出ます。フォントはブラウザが実行時に外部取得し、取得できない場合は`sans-serif`にフォールバックします

20人CPU負荷テストは、ローカルサーバー起動後に「3. 20人CPU負荷テスト」の手順で実行します。

## 2. 本番相当のローカル確認

```powershell
npm.cmd run build
$env:NODE_ENV="production"
npm.cmd start
```

確認URL:

```text
http://localhost:3000
```

確認観点:

- ログインできる
- 部屋を作成できる
- 別タブから参加できる
- パスコードなしの部屋へそのまま参加できる
- パスコードありの部屋で誤コードが拒否され、正しいコードで参加できる
- バトル/チームのステージを選べる
- 開始後にCPUが補充される
- スマホ幅でもボタンやHUDが重ならない
- 操作・状態ラベルが日本語で表示され、`Noto Sans JP`が読み込まれる
- 上部通知の表示・消去でロビーや試合画面の位置が動かない
- 通信断時の表示が出る
- 結果画面へ遷移できる
- カウントダウン後に出走者がリタイアでき、試合継続中は観戦へ移る
- 全人間出走者がゴールまたはリタイアすると結果画面へ遷移する
- ホストの結果画面からCSVをダウンロードでき、名前、順位、結果、時間、高度が正しく出力される

### 観戦モードでホスト操作を確認する

1. ログインして部屋を作成する
2. 待機画面の参加方法で「観戦する」を選択する
3. 「試合開始」を押す
4. ほかの出走者がいない場合、最大人数ぶんのCPUとライブ順位が表示されることを確認する
5. 「前へ」「次へ」で注目CPUを切り替える
6. 「試合終了」でリザルトへ移動する
7. ホストが順位に含まれないことを確認する
8. 「同じ設定で再戦」で1人の待機部屋へ戻る

ほかの出走者がいる場合は、その人を残して空き枠がCPUで補充されます。再戦時は出走・観戦の役割を維持します。

## 3. 20人CPU負荷テスト

本番相当のローカルサーバーを起動します。

```powershell
npm.cmd run build
$env:NODE_ENV="production"
npm.cmd start
```

別ターミナルで実行します。

```powershell
npm.cmd run test:cpu20
```

標準では以下の条件で実行します。

- URL: `http://127.0.0.1:3000`
- ステージ: `battle_10_everest_rush`
- 時間: 120秒
- 人数: 人間1人 + CPU19人

任意設定:

```powershell
$env:SKY_RUSH_URL="http://127.0.0.1:3000"
$env:SKY_RUSH_LOAD_TEST_MS="180000"
$env:SKY_RUSH_STAGE_ID="battle_03_cloud_jumble"
$env:SKY_RUSH_LOAD_PLAYERS="20"
npm.cmd run test:cpu20
```

CPUの移動を1秒ごとに確認する場合:

```powershell
$env:SKY_RUSH_TRACE_CPU="1"
npm.cmd run test:cpu20
```

確認観点:

- `Max players observed` が `20`
- `CPU players` が `19`
- `Game states` が継続して増えている
- `Max state gap` が極端に大きくない
- `Errors` が出ていない

## 4. ECS 手動デプロイ

### 4.1 前提確認

Docker Desktop を起動してから確認します。

```powershell
docker version
aws sts get-caller-identity
```

PowerShell のスクリプト実行ポリシーで止まる場合は、以下のように `-ExecutionPolicy Bypass` を付けます。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-ecs.ps1
```

### 4.2 デプロイ

標準設定:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-ecs.ps1
```

明示指定:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-ecs.ps1 `
  -Region ap-northeast-1 `
  -AppName sky-rush `
  -EcrRepository sky-rush `
  -StackName sky-rush-ecs `
  -DesiredCount 1
```

完了後、CloudFormation の Outputs に表示されるURLへアクセスします。

### 4.3 削除

ECS / ALB / VPC / CloudWatch Logs などのスタックを削除します。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\delete-ecs.ps1
```

ECR も含めて削除する場合:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\delete-ecs.ps1 -DeleteEcr
```

## 5. CloudWatch Logs 確認観点

ECS デプロイ後、CloudWatch Logs で以下を見ます。

- `Sky Rush listening on http://localhost:3000` が出ている
- サーバー起動直後にステージ検査エラーが出ていない
- Socket.IO 接続エラーが連続していない
- タスクが再起動ループしていない

## 6. よくあるトラブル

### npm が PowerShell で実行できない

`npm.ps1` が実行ポリシーで止まる場合があります。

```powershell
npm.cmd install
npm.cmd run dev
```

### Docker に接続できない

Docker Desktop が起動していない可能性があります。

```powershell
docker version
```

`Server` 情報が出ない場合は Docker Desktop を起動します。

### AWS CLI の認証がない

```powershell
aws configure
aws sts get-caller-identity
```

`Account` が表示されればOKです。

### デプロイ後にアクセスできない

以下を確認します。

- CloudFormation stack が `CREATE_COMPLETE` または `UPDATE_COMPLETE`
- ECS service の desired/running count が一致
- ALB の target group が healthy
- CloudWatch Logs に起動ログが出ている

### ステージでゴールできない

まずステージ検査を実行します。

```powershell
npm.cmd run check:stages
```

検査が通っていても手触りとして難しすぎる場合は、ステージ定義を調整します。

## 7. 現在の制限事項

- サーバーはメモリ上でルーム状態を管理します
- ECS タスクを複数台に増やす場合、同じ部屋の参加者が別タスクに分かれないよう、スティッキーセッションまたは共有状態管理が必要です
- ログインパスコードは現在固定値です
- `Noto Sans JP`はGoogle Fontsの外部配信のため、クライアントが外部フォントを取得できない場合は`sans-serif`で表示されます
- GitHub Actions 自動デプロイは未整備です

## 8. リリース作業メモ

v1.1以降のリリース目安:

1. `npm.cmd run check:stages`
2. `npm.cmd run typecheck`
3. `npm.cmd run lint`
4. `npx.cmd tsc -p tsconfig.server.json`
5. `npm.cmd run build`
6. `npm.cmd run test:host-controls`
7. 本番相当のローカル起動確認
8. 必要ならECSへ手動デプロイ
9. `package.json`のversionとリリースタグを揃える
10. Git tag / GitHub releaseを作成
