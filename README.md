# reiwa-form-api

れいわキャリア フォームLP（entry.reiwa-career.com）の Vercel API バックエンド。
元々 GAS Web App で動いていた処理を Vercel Serverless Functions に移植したもの。

## エンドポイント

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/form` | フォーム送信処理 (sendOTP/verifyOTP/firstSubmit/finalSubmit) |
| GET  | `/api/slots` | カレンダー空き枠取得 (quick_slots/all_slots/instantSlot) |

## 環境変数（Vercel ダッシュボード で設定）

- `GOOGLE_SERVICE_ACCOUNT_JSON` … GCP サービスアカウントの JSON キー（**JSONの中身全体を1つの値として貼り付け**）
- `SPREADSHEET_ID` … 顧客データDB スプシID
- `SHEET_NAME` … `顧客データDB`
- `CALENDAR_ID` … `box-reiwa_reservation@box-hr.co.jp`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SID`
- `SLACK_WEBHOOK_URL`
- `ALLOWED_ORIGINS` … `https://entry.reiwa-career.com,http://localhost:3002`

## デプロイ

```bash
# 初回
npx vercel link
npx vercel --prod
```

または GitHub に push → Vercel ダッシュボードでリポジトリインポート → Auto deploy

## v1/v2 のバージョン分岐

クエリ/ボディの `version` フィールドで分岐:

| version | 営業時間 | リードタイム | 1枠上限 |
|---|---|---|---|
| `v1`（既定） | 11:00–20:00 | 30分 | 1件 |
| `v2` | 10:00–20:00 | 15分 | 3件 |

