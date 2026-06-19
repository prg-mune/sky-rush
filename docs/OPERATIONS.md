# Sky Rush 運用手順

この文書は、Sky Rush をローカル確認、手動デプロイ、運用確認するための手順です。GitHub Actions 自動デプロイは現時点では対象外です。

## 1. リリース前チェックリスト

コード変更後は、以下を順番に実行します。

```powershell
npm.cmd run check:stages
npx.cmd tsc --noEmit
npx.cmd tsc -p tsconfig.server.json
npm.cmd run build
```

期待する状態:

- `Stage layout check passed.`
- TypeScript エラーがない
- `next build` が成功する
- webpack cache の warning は、ビルド成功とは別扱いです

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
- バトル/チームのステージを選べる
- 開始後にCPUが補充される
- スマホ幅でもボタンやHUDが重ならない
- 通信断時の表示が出る
- 結果画面へ遷移できる

## 3. ECS 手動デプロイ

### 3.1 前提確認

Docker Desktop を起動してから確認します。

```powershell
docker version
aws sts get-caller-identity
```

PowerShell のスクリプト実行ポリシーで止まる場合は、以下のように `-ExecutionPolicy Bypass` を付けます。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-ecs.ps1
```

### 3.2 デプロイ

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

### 3.3 削除

ECS / ALB / VPC / CloudWatch Logs などのスタックを削除します。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\delete-ecs.ps1
```

ECR も含めて削除する場合:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\delete-ecs.ps1 -DeleteEcr
```

## 4. CloudWatch Logs 確認観点

ECS デプロイ後、CloudWatch Logs で以下を見ます。

- `Sky Rush listening on http://localhost:3000` が出ている
- サーバー起動直後にステージ検査エラーが出ていない
- Socket.IO 接続エラーが連続していない
- タスクが再起動ループしていない

## 5. よくあるトラブル

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

## 6. v1.0 時点の制限事項

- サーバーはメモリ上でルーム状態を管理します
- ECS タスクを複数台に増やす場合、同じ部屋の参加者が別タスクに分かれないよう、スティッキーセッションまたは共有状態管理が必要です
- パスワードは現在固定値です
- GitHub Actions 自動デプロイは未整備です

## 7. リリース作業メモ

v1.0 化するときの目安:

1. `npm.cmd run check:stages`
2. `npx.cmd tsc --noEmit`
3. `npx.cmd tsc -p tsconfig.server.json`
4. `npm.cmd run build`
5. 本番相当のローカル起動確認
6. 必要ならECSへ手動デプロイ
7. `package.json` の version を `1.0.0` に更新
8. Git tag / GitHub release を作成

