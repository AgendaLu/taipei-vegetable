# 🌾 台北蔬菜批發行情查詢系統

[![Daily ETL](https://github.com/YiChengLu/taipei-vegetable/actions/workflows/daily_etl.yml/badge.svg)](https://github.com/YiChengLu/taipei-vegetable/actions/workflows/daily_etl.yml)

實時查詢台北地區蔬菜批發市場行情。直接串接農業部開放資料 API，每日自動更新市場價格、交易量與年度趨勢分析。

## 🎯 核心功能

### 📊 即時行情查詢
- **四大蔬菜品項** - 青花菜、牛番茄、洋蔥（區分本產/進口）
- **四個主要市場** - 台北一、台北二、三重區、板橋區  
- **詳細價格數據** - 最高價、中價、最低價、平均價、交易量
- **趨勢指標** - 與前日、同月去年的價格對比

### 📈 數據分析
- **90 天歷史走勢** - 互動式圖表、Sparkline 迷你圖
- **年度對比（YoY）** - 同月去年同期的價格對標
- **零售估算** - 根據批發價自動推估零售價格

### 🔄 自動化系統
- **每日凌晨 8 點自動更新** - GitHub Actions 定時執行
- **滾動 14 天視窗** - 每次跑都重抓過去 14 天 + 今天，自動修補因 workflow 失敗或 API 延遲產生的破洞（DB `INSERT OR IGNORE` 保護，不會重複）
- **資料庫同步** - Supabase PostgreSQL 完整保存，JSON 即時發布
- **Git 版本控制** - 每次更新自動提交，完整的資料變更歷史

---

## 🏗️ 項目結構

```
taipei-vegetable/
├── README.md                           # 本檔案
├── requirements.txt                    # Python 依賴
│
├── index.html                          # 前端主頁面（Tailwind CSS v4 CDN）
├── app.js                              # 前端主邏輯（D3.js + Fuse.js）
│
├── .github/
│   └── workflows/
│       └── daily_etl.yml               # 每日 ETL：滾動 14 天視窗 + JSON 發布
│
├── etl/                                # 資料抓取與轉換（Python 模組）
│   ├── fetch_prices.py                 # 單日抓取（含 fallback lookback）
│   ├── fetch_with_fallback.py          # 智慧回溯（當日無資料時往前查）
│   ├── backfill.py                     # 任意區間歷史補抓
│   ├── export_json.py                  # 由 DB 產出前端 JSON
│   ├── catalog.py                      # 讀取 crops.yaml 提供品項代號
│   ├── db.py                           # PostgreSQL / SQLite 連線管理
│   └── crops.yaml                      # 追蹤品項設定（SSOT）
│
├── data/                               # 前端資料（ETL 產出，Git 追蹤）
│   ├── latest.json                     # 最新交易行情
│   ├── history.json                    # 90 天歷史走勢
│   ├── weekly_digest.json              # 週統計摘要
│   ├── yoy.json                        # 年度同期對比
│   ├── crops_index.json                # 品項索引（搜尋用）
│   └── yoy_historical_2024_2025.json   # 2024-2025 歷史基準
│
├── docs/
│   └── architecture-fly.md             # 架構演進筆記
│
├── sandbox/                            # 前端測試沙盒（mock 資料）
│   ├── index.html
│   ├── generate_mock.py
│   └── data/
│
├── agri_prices.db                      # 本地 SQLite（無 DATABASE_URL 時使用）
├── postman_collection.json             # Postman API 測試集合
├── test_api.sh                         # Shell 快速測試腳本
├── example_fallback.py                 # fallback 用法範例
│
├── API_TESTING_README.md               # API 測試方案總覽
├── API_TESTING_GUIDE.md                # 詳細測試指南
├── API_TEST_SOLUTION.md                # 測試方案設計
├── QUICK_START.md                      # 30 秒快速上手
├── ETL_ANALYSIS.md                     # ETL 邏輯分析
└── YOY_STRATEGY.md                     # YoY 計算策略
```

---

## 🚀 快速開始

### 前端：查看最新行情

1. **在瀏覽器打開** `index.html`
2. **搜尋蔬菜** - 支援中文、英文、別名（如「茄」可搜到「番茄」）
3. **檢視走勢** - 點擊品項卡片看 90 天歷史圖表
4. **年度對比** - 自動計算與去年同月的價差

### 後端：本地開發

#### 環境設置

```bash
# 克隆專案
git clone https://github.com/YiChengLu/taipei-vegetable.git
cd taipei-vegetable

# 建立虛擬環境
python3 -m venv .venv
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate   # Windows

# 安裝依賴
pip install -r requirements.txt

# 設定 API Key（從農業部申請）
export MOA_API_KEY='your_api_key_here'

# 可選：設定資料庫（本地開發可不設）
export DATABASE_URL='postgresql://user:password@host/dbname'
```

#### 抓取當日資料

```bash
# 執行日常抓取（包括智慧回溯）
python -m etl.fetch_prices

# 指定日期
python -m etl.fetch_prices --date 2026-04-19

# 不使用回溯功能
python -m etl.fetch_prices --no-fallback
```

#### 補抓歷史資料

```bash
# 補抓 2024-01-01 至 2025-12-31
python -m etl.backfill --start 2024-01-01 --end 2025-12-31

# 預覽（不實際抓取）
python -m etl.backfill --dry-run
```

#### 生成前端 JSON

```bash
# 根據資料庫生成 latest.json、history.json 等
python -m etl.export_json
```

---

## 📊 數據說明

### 數據來源
- **農業部開放資料平台** - [農產品交易行情 API](https://data.moa.gov.tw)
- **API 版本** - v1
- **更新頻率** - 每日 08:00（台灣時間）

### 關鍵欄位

| 欄位 | 說明 | 範例 |
|------|------|------|
| `trade_date` | 交易日期（YYYY-MM-DD） | 2026-04-19 |
| `crop` | 品項名稱 | 牛番茄 |
| `market` | 市場名稱 | 台北一 |
| `volume_kg` | 交易量（公斤） | 24911.0 |
| `upper_price` | 最高價（元/kg） | 78.1 |
| `mid_price` | 中價（元/kg） | 40.8 |
| `lower_price` | 最低價（元/kg） | 15.5 |
| `avg_price` | 平均價（元/kg） | 43.2 |
| `change_pct` | 與前日變化（%） | +2.5 |

### 民國年格式轉換

農業部 API 使用民國年格式（ROC calendar）。轉換公式：

```
民國年 = 西元年 - 1911
例：2026-04-19 → 115.04.19
```

---

## 🔧 技術棧

### 前端
- **HTML5 + Tailwind CSS v4 (Play CDN)** - 結構與樣式
- **D3.js** - 資料視覺化（Trend Chart 折線圖、Sparkline 迷你圖）
- **Fuse.js** - 模糊搜尋（支援中文別名）
- 純靜態頁面，無打包工具，直接開 `index.html` 即可使用

### 後端
- **Python 3.11+** - 核心語言
- **requests** - HTTP 請求
- **psycopg2** - PostgreSQL 驅動
- **PyYAML** - 配置管理

### 資料庫
- **Supabase PostgreSQL** - 主資料庫
- **JSON 檔案** - 前端快取（Git 追蹤）

### CI/CD
- **GitHub Actions** - 定時任務、自動發布
- **Git** - 版本控制、資料變更歷史

---

## 🔄 ETL 工作流程

```
┌─ Daily ETL (每天 08:00 台灣時間)
│
├─ Fetch last 14 days + today
│  ├─ for D in (today-14 .. today-1): fetch_prices --date $D --no-fallback
│  ├─ fetch_prices  (today, 含 fallback 處理 API 延遲)
│  └─ DB INSERT OR IGNORE → 既有日期不重複，破洞自動補滿
│
├─ Export JSON
│  ├─ latest.json          # 最新交易行情
│  ├─ history.json         # 90 天歷史走勢
│  ├─ weekly_digest.json   # 週統計摘要
│  ├─ yoy.json             # 年度對比
│  └─ crops_index.json     # 搜尋索引
│
├─ Cache-bust index.html
│  └─ 更新 <!-- cache-buster: TIMESTAMP --> 強制瀏覽器重抓
│
└─ Commit & Push
   └─ commit message: "data: update <latest_trade_date>"
```

### 兩層容錯設計

**第一層：滾動 14 天視窗（workflow 層）**
每次自動跑都重抓過去 14 天，所以即使 workflow 連續失敗幾天，下次成功時也會把破洞補回。這是主要的容錯機制。

**第二層：智慧回溯（單日抓取層）**
當「今天」呼叫 API 還沒上架時，`fetch_with_fallback` 會自動往前查：

```
查詢 2026-04-20 → 無資料
  ↓
查詢 2026-04-19 → 有資料 ✓
  ↓
返回 2026-04-19（actual_date = 2026-04-19，確保 latest.json 永遠有值）
```

可由 `LOOKBACK_DAYS` 環境變數控制（預設 3 天）。歷史 14 天迴圈用 `--no-fallback`，避免重複往回查。

---

## 🧪 API 測試

完整的 API 測試解決方案，包括 Postman 集合、Shell 腳本、Python 示例：

### Postman 集合

1. 導入 `postman_collection.json`
2. 設定環境變數（API Key、民國年日期）
3. 發送請求測試各個端點

### Shell 快速測試

```bash
chmod +x test_api.sh
./test_api.sh
```

自動測試多個品項和日期，包括回溯邏輯驗證。

### Python 示例

```bash
python example_fallback.py
```

完整的 5 個使用示例，涵蓋：
- 基本單日查詢
- 自動回溯
- 日期對比
- 多品項批量查詢
- 日期格式轉換

### 詳細指南

- **QUICK_START.md** - 30 秒快速上手
- **API_TESTING_GUIDE.md** - 完整測試指南
- **API_TEST_SOLUTION.md** - 方案設計詳解

---

## 📖 重要檔案說明

### `crops.yaml`
品項對照表（SSOT - Single Source of Truth）。定義：
- 追蹤的品項代號
- 顯示名稱
- 別名（用於搜尋）
- 類別

修改此檔案會影響整個系統的品項清單。

### `db.py`
資料庫連線管理：
- PostgreSQL 連線池
- Schema 自動建立
- SQL 執行包裝（相容 sqlite3 風格）

### `export_json.py`
前端資料生成引擎：
- 從資料庫查詢
- 聚合計算（平均價、交易量、YoY）
- 生成 JSON 輸出

---

## 🌍 部署到 Production

### 自動部署（推薦）

GitHub Actions 已配置自動化：
1. 每天 UTC 00:00（台灣 08:00）執行
2. 抓取資料 → 生成 JSON → 自動提交 Git

無需人工干預。

### 手動部署

若需立即更新：

```bash
# 方式 1：觸發 GitHub Actions
gh workflow run daily_etl.yml

# 方式 2：本地執行並推送
python -m etl.fetch_prices
python -m etl.export_json
git add data/
git commit -m "data: manual update $(date +%Y-%m-%d)"
git push
```

### 環境變數配置

在 GitHub Secrets 中設定：

| 變數 | 說明 |
|------|------|
| `MOA_API_KEY` | 農業部 API Key（必填） |
| `DATABASE_URL` | Supabase PostgreSQL 連線（必填） |
| `LOOKBACK_DAYS` | 回溯天數（可選，預設 3） |

---

## 🐛 常見問題

### Q1：某個日期沒有資料？
農業部 API 在假日或特殊日期可能無資料。系統會自動往回查詢（預設 3 天），確保 `latest.json` 始終有最新可用資料。

### Q2：前端顯示舊資料？
**瀏覽器快取問題**，嘗試：
- 隱私瀏覽（Ctrl+Shift+P）
- 強制刷新（Ctrl+F5）
- 清除瀏覽器快取（Ctrl+Shift+Delete）

### Q3：如何新增其他蔬菜品項？
1. 從農業部 API 文檔查詢作物代號
2. 在 `crops.yaml` 中加入新品項
3. 設定 `tracked: true` 以啟用追蹤
4. 執行 `backfill.py` 補抓歷史資料

### Q4：資料準確性如何保證？
- 直接串接農業部官方 API（非爬蟲）
- 完整的 ETL 日誌審計
- Git 版本控制追蹤每次變更
- 資料庫與 JSON 雙重備份

---

## 📝 開發指南

### 新增功能

1. **新增品項** - 編輯 `crops.yaml`
2. **修改前端** - 編輯 `app.js` 和 `style.css`
3. **修改 ETL** - 編輯 `etl/*.py`
4. **測試** - 用 Postman 或 Shell 腳本驗證

### 提交代碼

遵循慣例提交訊息：
```
feat: 新增功能說明
fix: 修復 bug 說明
docs: 文檔更新
refactor: 代碼重構
test: 測試相關
data: 資料更新（由自動化系統使用）
```

### 測試前端

無需後端，直接在瀏覽器打開 `index.html`：
- 使用本地 `data/*.json`
- 支援所有交互功能
- 搜尋、圖表、計算等

---

## 📊 數據統計

目前追蹤：
- **品項數** - 4 個（青花菜、牛番茄、洋蔥-本產/進口）
- **市場數** - 4 個（台北一、台北二、三重區、板橋區）
- **歷史深度** - 90 天 + 2024-2025 年度對比
- **更新頻率** - 每日 1 次
- **資料保留** - 永久（Git 版本控制）

---

## 🔐 安全與隱私

- 不存儲個人用戶資料
- 不使用第三方跟蹤代碼
- API Key 存儲在 GitHub Secrets（不提交代碼）
- 資料庫連線字串加密

---

## 📞 支持與反饋

- **問題報告** - [GitHub Issues](https://github.com/YiChengLu/taipei-vegetable/issues)
- **功能建議** - [GitHub Discussions](https://github.com/YiChengLu/taipei-vegetable/discussions)
- **資料驗證** - 與農業部官方數據對標

---

## 📄 授權

MIT License - 見 [LICENSE](LICENSE) 檔案

---

## 🙏 致謝

- **農業部開放資料平台** - 提供 API 與資料
- **D3.js、Tailwind CSS、Fuse.js** - 開源社群
- **GitHub Actions、Supabase** - 基礎設施

---

**最後更新：2026-05-08**  
**部署狀態** - [![Daily ETL](https://github.com/YiChengLu/taipei-vegetable/actions/workflows/daily_etl.yml/badge.svg)](https://github.com/YiChengLu/taipei-vegetable/actions)
