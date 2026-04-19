# 後端分離架構規劃：ETL 搬到 fly.io

> 狀態：**草稿 / 待討論**
> 分支：`feat/fly-backend`
> 建立日期：2026-04-19

這份文件是昨天討論「把 ETL 搬到 fly.io、規劃更長遠大型資料搜集計劃」的後續整理，目的是在動手之前先對齊架構方向、列出決策點、找出風險。

---

## 1. 為什麼要動？現況的限制

目前架構：

- **排程**：GitHub Actions（`.github/workflows/daily_etl.yml`），每天 UTC 00:00 / 台灣 08:00 跑一次。
- **資料庫**：SQLite（`agri_prices.db`），透過 `actions/cache` 在每次 Action 執行之間保存。
- **資料出口**：在 job 裡跑 `etl/export_json.py`，把產出的 `data/*.json` **直接 commit 回 main 分支**，前端（`index.html` + `app.js`）以靜態方式讀取。
- **前端託管**：靜態網站（推測為 GitHub Pages 或類似）。

隨著要做「長期大型資料搜集」，現況會撞到幾個問題：

| 問題 | 說明 |
|---|---|
| **GH Actions cache 不是持久儲存** | cache 有 7 天未被讀取就會被 evict、總容量 10GB 上限；資料量成長後風險升高。`restore-keys` 已是目前的緩衝但不是正解。 |
| **Git 膨脹** | 每天 commit `data/*.json` 回 repo，長期 repo 會臃腫（已經能從 git log 看到 `data: update ...` 的日常 commit）。SQLite binary 不能進 git。 |
| **抓取視窗受限** | GH Actions 單 job 最長 6 小時，且排程有抖動（cron 不精準）。要補抓歷史、做多市場 × 多品項的大批次會卡。 |
| **無法對外提供查詢** | 前端只能拿預先產出的 JSON，無法做彈性查詢（任意日期區間、任意品項組合、即時統計）。 |
| **觀測性差** | fetch_log 在 SQLite 裡，但 cache 斷掉就消失，也沒有集中的 log / metrics。 |

---

## 2. 提議的目標架構

```
┌─────────────────────────────────────────────────────────────┐
│                         fly.io                              │
│  ┌──────────────────┐        ┌──────────────────────────┐   │
│  │ ETL worker       │  寫入   │ Postgres (managed)        │   │
│  │ (Python, cron)   │ ──────▶ │  或 SQLite on fly volume  │   │
│  │  - fetch_prices  │        └──────────────────────────┘   │
│  │  - backfill      │                      ▲                │
│  │  - export        │                      │                │
│  └──────────────────┘                      │                │
│           │                                │                │
│           ▼                                │                │
│  ┌──────────────────┐                      │                │
│  │ API server       │  讀取                 │                │
│  │ (FastAPI)        │ ─────────────────────┘                │
│  │  - /latest       │                                       │
│  │  - /history      │                                       │
│  │  - /weekly       │                                       │
│  │  - /search       │                                       │
│  └──────────────────┘                                       │
│           │                                                 │
└───────────┼─────────────────────────────────────────────────┘
            │ HTTPS + CORS
            ▼
    ┌──────────────────┐
    │ 靜態前端 (現狀)   │
    │ index.html/app.js│
    └──────────────────┘
```

三個元件：

1. **ETL Worker**：排程跑 `fetch_prices` / `export`，不再 commit 回 repo，直接寫 DB。
2. **API Server**：把前端需要的查詢（原本 `latest.json`/`history.json`/...）改成 HTTP endpoint，讓前端可以做更彈性的查詢。
3. **資料庫**：SQLite 放 fly volume，或升級到 fly Postgres。

---

## 3. 關鍵決策點（需要先對齊）

這幾項會影響後續所有實作，請先討論：

### 3.1 DB 要不要從 SQLite 換成 Postgres？

| 選項 | 優 | 缺 |
|---|---|---|
| **A. 保留 SQLite，放 fly volume** | 現有 `etl/db.py` 幾乎不用改；單檔、備份容易；本機開發無差別 | 單機綁定（volume 綁 VM）；並行寫入有限；升級時要 downtime |
| **B. 升級 Postgres（fly managed）** | 真正能長期擴張；可同時跑多個 worker；有正規備份/監控 | schema 重寫、migration 工具（Alembic）；多一份託管成本 |
| **C. 先 SQLite，預留抽象層，之後再換** | 低風險、先把 fly 部署跑通 | 之後換 Postgres 仍要一次 migration |

**我的傾向**：**C → B**。先以 SQLite + volume 把 fly 架構跑通（最短路徑），同時在 `etl/db.py` 包一層 DAL（只 export 函式、不讓外部直接寫 SQL），讓之後換 Postgres 的工作集中在一個檔案。

### 3.2 前端要不要改？

| 選項 | 說明 |
|---|---|
| **A. 前端完全不動**：ETL worker 把 `data/*.json` 寫到物件儲存（Cloudflare R2 / S3），前端改 fetch 那個 URL | 改動最小、仍是靜態檔快取友善；但失去「彈性查詢」的好處 |
| **B. 前端改打 API**：新 FastAPI 提供 endpoint，前端 `app.js` 改 fetch 新的 API | 能彈性查詢、即時資料；但要處理 CORS、認證（是否公開）、前端要改 |
| **C. 兩者並行**：API 優先做起來，前端短期先用 JSON 靜態檔（由 ETL 輸出到物件儲存），之後再逐頁遷移 | 風險最低的漸進路徑 |

**我的傾向**：**C**。API 先蓋起來不代表前端馬上遷移，可以先驗證 fly 架構穩定、再慢慢讓前端改打 API。

### 3.3 排程用什麼？

| 選項 | 說明 |
|---|---|
| **A. `fly machines run --schedule`** | fly 原生；簡單；但粒度有限、失敗處理要自己寫 |
| **B. 容器內 cron / supercronic** | 更靈活；可以同時跑多個 job；但 VM 要一直開 |
| **C. 把排程留在 GitHub Actions，只是改成呼叫 fly API** | 漸進路徑；GHA 只負責「按時戳一下 API」，實際工作在 fly 跑 | 

**我的傾向**：**A**。fly 原生排程最單純，且未來要補抓歷史時可以手動 `fly machines run` 另起一台跑 `backfill`。

### 3.4 抓取範圍要不要擴大？

現在 `fetch_prices.py` 只抓 `crops.yaml` 裡 `tracked: true` 的品項、四個北部市場。如果「長期大型資料搜集」是目標，要先決定：

- 要把 `TARGET_MARKETS` 擴到全台所有批發市場嗎？
- 要把所有 `crops.yaml` 的品項都抓嗎？（不只 tracked）
- 歷史資料要回補到哪一年？（MOA API 最早 2005）

這會直接影響 DB 設計與儲存容量估算，**建議先決定抓取範圍、才能算磁碟用量**。

---

## 4. 分階段實作建議

> 每個階段都能獨立出貨、獨立驗證，不會一次大改。

### Phase 0：準備（現在）
- [x] 建立 `feat/fly-backend` 分支
- [ ] 決定 §3 四個決策點
- [ ] 決定抓取範圍，估算 DB 一年成長量

### Phase 1：ETL 搬到 fly（DB 仍 SQLite / volume）
- [ ] 寫 `Dockerfile`（Python 3.11 + requirements.txt + etl/）
- [ ] 寫 `fly.toml` + volume 宣告
- [ ] `fly secrets set MOA_API_KEY=...`
- [ ] 用 fly scheduled machine 每天跑 `fetch_prices`
- [ ] ETL 暫時仍把 JSON 寫回 repo（透過 GitHub App token），前端完全不動
- [ ] 關掉或精簡現有 `daily_etl.yml`（避免雙跑）

**驗收**：連續一週 fly 上的排程都成功跑、`data/*.json` 仍每日更新、前端無感。

### Phase 2：API 層上線（並行）
- [ ] 在同 repo 新增 `api/` 目錄，FastAPI app
- [ ] endpoint：`/latest`、`/history`、`/weekly`、`/yoy`、`/crops`
- [ ] 共用 `etl/db.py` 的 DAL 函式
- [ ] fly 部署第二個 app（或同 app 多 process）
- [ ] 前端仍讀 JSON，**不改**

**驗收**：API 公開可打，回應內容與 JSON 檔一致。

### Phase 3：前端遷移
- [ ] `app.js` 改 fetch API；保留 JSON fallback 一段時間
- [ ] 加入前端本來做不到的功能（例：任意日期區間查詢）

**驗收**：前端完全透過 API 取得資料，舊 JSON 產出可以停用。

### Phase 4（可選）：升級 Postgres
- [ ] fly Postgres 建立
- [ ] Alembic migration
- [ ] 雙寫一段時間 → 切換 → 關掉 SQLite

---

## 5. 風險與開放問題

- **成本**：fly 免費額度（shared-cpu-1x、3GB volume）對目前規模夠，但若擴到全台所有市場 × 所有品項 × 20 年歷史，需要先算。
- **資料主權**：MOA API 的使用條款有沒有限制「不得轉存提供第三方 API」？（目前只自用應該 OK，但要確認）
- **備份策略**：fly volume 不是 HA，需要定期 dump 到 R2 / S3。Postgres 的話 fly 有 snapshot。
- **前端的 CORS / rate limit**：API 公開後要不要做基本保護？
- **GitHub Actions 要不要完全撤？** 還是保留當成「備援抓取」？

---

## 6. 下一步

等 §3 四個決策點有結論之後，才進 Phase 1。這份文件應該隨決策更新，不要讓它變成寫完就冰起來的 one-shot doc。
