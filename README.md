# Sky Rush v0.1

Sky Rush は、ブラウザで遊べるオンライン登山レースゲームです。Phaser 3 でゲーム画面を描画し、Socket.IO でリアルタイム同期します。

## 現在できること

- バトルロワイヤル登山とチーム登山
- 最大 20 人相当のレース。参加人数が足りない場合は CPU が補充されます
- 複数ステージ、難易度、コース高度の選択
- 消える床、伸縮バー、押し合い、味方踏み台、チーム協力ギミック
- スマホ縦持ち操作
- 接続断からの再接続、切断中プレイヤー表示、空部屋クリーンアップ
- ステージ到達性チェック
- Docker / ECS 手動デプロイ用スクリプト

## 遊び方

1. ブラウザで `http://localhost:3000` またはデプロイ先URLを開きます。
2. プレイヤー名を入力します。
3. パスワードに `progress4649` を入力します。
4. ロビーで部屋を作るか、既存の部屋に参加します。
5. ホストが開始すると、足りない人数はCPUで補充されます。

## 操作

PC:

- `A` / `D` または左右キー: 左右移動
- `Space`: ジャンプ
- `Space` 長押し: 高めのジャンプ

スマホ:

- 画面タップ/長押し: ジャンプ
- 画面を左右へ押し込むようにドラッグ: 左右移動

## ローカル起動

PowerShell では `npm.ps1` の実行ポリシーで止まることがあるため、困ったら `npm.cmd` を使ってください。

```powershell
npm.cmd install
npm.cmd run dev
```

起動後、ブラウザで以下を開きます。

```text
http://localhost:3000
```

## 品質チェック

変更後は、最低限以下を実行します。

```powershell
npm.cmd run check:stages
npx.cmd tsc --noEmit
npx.cmd tsc -p tsconfig.server.json
npm.cmd run build
```

それぞれの意味:

- `check:stages`: 全ステージのゴール前安全帯と足場到達性を検査
- `tsc --noEmit`: フロント/共有コードの型チェック
- `tsc -p tsconfig.server.json`: サーバー側の型チェック
- `npm run build`: Next.js とサーバーを本番ビルド

## 本番相当のローカル起動

```powershell
npm.cmd run build
$env:NODE_ENV="production"
npm.cmd start
```

確認URL:

```text
http://localhost:3000
```

## Docker 起動

Docker Desktop を起動した状態で実行します。

```powershell
docker compose up --build
```

確認URL:

```text
http://localhost:3000
```

## ECS 手動デプロイ

AWS CLI と Docker Desktop が必要です。AWS CLI の認証が済んでいることを確認します。

```powershell
aws sts get-caller-identity
docker version
```

デプロイ:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-ecs.ps1
```

主なパラメータ:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-ecs.ps1 `
  -Region ap-northeast-1 `
  -AppName sky-rush `
  -EcrRepository sky-rush `
  -StackName sky-rush-ecs `
  -DesiredCount 1
```

削除:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\delete-ecs.ps1
```

ECR リポジトリも含めて削除:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\delete-ecs.ps1 -DeleteEcr
```

## 運用手順

詳しい手順は [docs/OPERATIONS.md](docs/OPERATIONS.md) を参照してください。

主に含まれる内容:

- リリース前チェックリスト
- ローカル確認手順
- ECS 手動デプロイ手順
- CloudWatch Logs の確認観点
- トラブルシュート
- v1.0 時点の制限事項

## v1.0 に向けた残タスク

- 20人CPU負荷テスト
- README/運用手順の継続更新
- `package.json` の version を `1.0.0` へ更新
- GitHub tag / release の作成
