# 日語階梯

N3 → N2 年度離線學習 PWA。資料先保存在 IndexedDB；使用者可自行授權 Google 雲端硬碟，在手機與電腦間同步。

## Google 雲端硬碟同步

1. 在 Google Cloud 建立專案並啟用 Google Drive API。
2. 設定 OAuth 同意畫面；若維持測試模式，將使用者加入 Test users。
3. 建立「Web application」OAuth Client ID，Authorized JavaScript origins 加入 `http://localhost:5173` 與 `https://sam9128.github.io`。
4. 複製 `.env.example` 為 `.env.local` 並填入 Client ID；GitHub Pages 則建立 Repository variable `VITE_GOOGLE_CLIENT_ID`。

網站採 Google Identity Services token model，只要求 `drive.appdata` 權限。備份位於使用者 Drive 的隱藏 `appDataFolder`；access token 僅存在記憶體，不寫入 IndexedDB、localStorage 或備份。OAuth Client ID 可公開，請勿加入 Client Secret。

## 本機執行

```bash
pnpm install
pnpm run validate:content
pnpm run dev
```

正式建置使用 `pnpm run build`。推送到 `main` 後，根目錄的 GitHub Actions 工作流程會自動建置並部署 GitHub Pages。

## 教材更新

年度教材已生成於 `public/content/periods/`。若要從開放詞彙來源重新產生：

```bash
pnpm run generate:content
pnpm run validate:content
```

生成器讀取專案上層 `tmp/` 底下兩份只在重新產生時才需要的外部資料，兩者都不進版控
（見上層 `.gitignore`），網站正式執行也不依賴它們——只讀已生成的月份分包：

| 路徑 | 內容 | 取得方式 |
|---|---|---|
| `tmp/jmdict/jmdict-index.json` | JMdict 的詞形、假名讀音、詞性與英文語義 | 自 <https://www.edrdg.org/jmdict/j_jmdict.html> 下載 `JMdict_e.gz`，以 `tmp/jmdict/build-index.mjs` 建索引 |
| `tmp/jmdict/apkg-readings.json` | 詞形 → 讀音，來自 N3／N2 総まとめ 牌組 | 由上層的兩個 `.apkg` 匯出 |
| `tmp/language-learning-decks/japanese/` | CEFR 分級與例句 | clone <https://github.com/vbvss199/Language-Learning-decks> |

重建整個單字骨幹（詞形、讀音、詞性、英文語義）是另一支腳本，只在來源換版時才需要執行；
它會重寫 `scripts/source/vocab-authority.json`，並把換過字的 id 記進 `vocab-reissued-ids.json`，
App 會據此清除那些卡片的學習紀錄：

```bash
node scripts/rebuild-vocab-authority.mjs
```

手動審定過的讀音（詞表與 JMdict 不一致的那幾條）放在 `scripts/source/vocab-reading-review.json`，
重建時會自動套回，`validate-content.mjs` 也會重算把關。

例句繁體中文直譯保存在 `scripts/source/example-translations-zh.json`，網站執行時不會連線翻譯服務。新增例句後可執行 `pnpm run translate:examples` 補齊缺漏，再重新產生與驗證教材；此命令只傳送公開教材例句，不傳送使用者資料。

N3／N2 單字與文法會以時雨之町的公開分類頁交叉校對，但不轉載其受著作權保護的講解、例句與測驗。閱讀教材採 52 篇自編新聞模組，包含分類、標題、導語、摘要提示與理解題。

首頁與進度成果頁會依每月新增教材量及當月天數，自動計算截至今天的累積應達量；單字／文法需達「記得」以上，閱讀／聽力完成作答，才會計入實際完成量，並顯示超前、符合或落後指標。

## 資料與著作權

完整署名請見 `public/content/ATTRIBUTION.md`。JLPT 官方試題與音檔只提供來源連結，未收錄或轉載。
