# 農業部菜價 API 完整測試方案

## 📌 問題描述

- **問題**：API 資料時常有缺漏，當日無數據
- **需求**：確認 API 調用的 Start_Time & End_Time 參數是否正確，且當日無數據應自動往回查前一日
- **目標**：提供多種測試方式，並實現自動回溯邏輯

---

## ✅ 解決方案概覽

本方案提供 **3 個層面** 的解決方法：

| 層面 | 工具 | 特點 | 適合人群 |
|------|------|------|--------|
| **GUI** | Postman 集合 | 視覺化、易操作 | 產品經理、QA |
| **Shell** | `test_api.sh` | 快速批量測試 | DevOps、工程師 |
| **Python** | `fetch_with_fallback.py` | 靈活、可編程 | 後端開發、資料工程 |

---

## 🚀 快速開始（5 分鐘）

### 1. 設定環境
```bash
export MOA_API_KEY='your_api_key_here'
export LOOKBACK_DAYS=3  # 可選
```

### 2. 快速測試
```bash
# 方式 A：Shell 腳本（推薦新手）
chmod +x test_api.sh
./test_api.sh

# 方式 B：Python 示例（推薦開發者）
python example_fallback.py

# 方式 C：Postman（推薦 GUI）
# 導入 postman_collection.json
```

### 3. 整合到你的代碼
```python
from etl.fetch_with_fallback import fetch_crop_with_fallback
from datetime import date

# 自動回溯：當日無數據查前一日（最多 3 天）
records, status, actual_date = fetch_crop_with_fallback(
    target=date.today(),
    crop_code="N00100",  # 白菜
    api_key=os.environ["MOA_API_KEY"],
    max_lookback=3
)

if status == "ok":
    print(f"✓ 取得 {len(records)} 筆（日期：{actual_date}）")
```

---

## 📁 新增檔案清單

### 文檔
- **QUICK_START.md** - 快速開始指南（本檔案）
- **API_TESTING_GUIDE.md** - 詳細測試文檔
- **API_TEST_SOLUTION.md** - 方案總覽（本檔案）

### 工具
- **postman_collection.json** - Postman 測試集合
- **test_api.sh** - Shell 測試腳本（可執行）
- **example_fallback.py** - Python 完整示例

### 核心模組
- **etl/fetch_with_fallback.py** - 自動回溯的 API 查詢模組（新增）
- **etl/fetch_prices.py** - 改進版本（已整合回溯邏輯）

---

## 🔍 三種測試方式對比

### 方式 A：Postman（最直觀）

**優點：**
- ✓ 無需編程知識
- ✓ 視覺化介面
- ✓ 易於與他人分享測試案例
- ✓ 支持自動化測試 (newman)

**使用流程：**
```
1. Postman → Import → 選擇 postman_collection.json
2. 設定環境變數（MOA_API_KEY、日期）
3. 選擇 request → 點擊 Send
4. 檢查 Response（Status code、Data 筆數）
```

**檢查點：**
| 項目 | 期望值 | 說明 |
|------|--------|------|
| HTTP Status | 200 | API 連接正常 |
| RS 欄位 | OK | API 伺服器回應正常 |
| Data 欄位 | 陣列 | 實際返回的數據 |
| MarketName | 台北一 等 | 資料來源市場 |

---

### 方式 B：Shell 腳本（最快速）

**優點：**
- ✓ 一行命令執行
- ✓ 自動批量測試多日期、多品項
- ✓ 支持回溯邏輯驗證
- ✓ 彩色輸出易於閱讀

**執行方式：**
```bash
./test_api.sh
```

**輸出示例：**
```
▶ 查詢 2026-04-20 - 白菜
✓ 成功：245 筆
  市場: 台北一 | 品項: 白菜 | 交易量: 1234 | 平均價: 5.5

▶ 查詢 2026-04-20 - 蕃茄（如無資料則回溯）
– 無資料（日期: 2026-04-20），往回查詢
✓ 找到資料（日期: 2026-04-19）: 156 筆
```

**腳本會測試：**
1. 今日單日查詢（白菜）
2. 今日單日查詢（蕃茄）
3. 自動回溯查詢（最多 3 天）

---

### 方式 C：Python 腳本（最靈活）

**優點：**
- ✓ 完全控制邏輯
- ✓ 易於集成到自動化流程
- ✓ 可自訂回溯天數、詳細度
- ✓ 支持多種查詢模式

**基本用法：**
```python
from etl.fetch_with_fallback import fetch_crop_with_fallback
from datetime import date

records, status, actual_date = fetch_crop_with_fallback(
    target=date(2026, 4, 20),
    crop_code="N00100",
    api_key="YOUR_API_KEY",
    max_lookback=3,
    verbose=True
)
```

**高級用法：**
```python
# 查詢單日（無回溯）
from etl.fetch_with_fallback import fetch_single_day
records, status, _ = fetch_single_day(date(2026, 4, 20), "N00100", api_key)

# 日期轉換
from etl.fetch_with_fallback import to_minguo
minguo = to_minguo(date(2026, 4, 20))  # "115.04.20"

# 執行示例
python example_fallback.py
```

---

## 🔄 回溯邏輯詳解

### 工作流程

```
【查詢：2026-04-20 白菜】
    ↓
API: Start_time=115.04.20, End_time=115.04.20
    ↓
    返回空數據 (Data = [])
    ↓
【自動回溯】
    ↓
API: Start_time=115.04.19, End_time=115.04.19
    ↓
    返回 156 筆數據 ✓
    ↓
【返回結果】
status = "ok"
actual_date = 2026-04-19
records = [... 156 筆 ...]
```

### 控制參數

| 參數 | 類型 | 默認值 | 說明 |
|------|------|--------|------|
| `target` | date | 必填 | 目標查詢日期 |
| `crop_code` | str | 必填 | 作物代號（e.g., N00100） |
| `api_key` | str | 必填 | MOA API Key |
| `max_lookback` | int | 3 | 最多往回查詢幾天 |
| `verbose` | bool | False | 是否印出查詢過程 |

### 返回值

| 欄位 | 類型 | 說明 |
|------|------|------|
| `records` | list | 查詢到的記錄清單 |
| `status` | str | `"ok"` 成功 / `"empty"` 無資料 / `"error: ..."` 錯誤 |
| `actual_date` | date | 實際取得資料的日期 |

---

## 📊 時間參數說明

### 民國年格式

API 使用 **民國年** 格式：`YYY.MM.DD`

**轉換公式：** 民國年 = 西元年 - 1911

**範例：**
```
2026-04-20 → 115.04.20
2025-01-01 → 114.01.01
2024-12-31 → 113.12.31
```

### API 查詢範例

```
GET https://data.moa.gov.tw/api/v1/AgriProductsTransType/
?apikey=YOUR_API_KEY
&format=json
&CropCode=N00100          # 白菜
&Start_time=115.04.20     # 2026-04-20
&End_time=115.04.20       # 同一日
&Page=1
```

### Postman 變數

在 Postman 中自動計算：
```
{{today_minguo}}     # 今日民國年
{{yesterday_minguo}} # 前一日民國年
```

---

## 🐛 常見問題排查

### Q1: 401 Unauthorized
**症狀：** API 回應 401
**原因：** API Key 錯誤
**解決：**
```bash
echo $MOA_API_KEY  # 檢查是否已設定
# 重新設定
export MOA_API_KEY='correct_key'
```

### Q2: 所有日期都無資料
**症狀：** status = "empty"，即使回溯多天
**可能原因：**
- 該品項確實無該日期數據
- API 服務維護中
- 品項代號錯誤

**排查步驟：**
```bash
# 1. 試試其他品項
curl "...&CropCode=N01600&..."  # 蕃茄

# 2. 查詢最近一週
curl "...&Start_time=115.04.14&End_time=115.04.20&..."

# 3. 查詢農業部網站
# https://data.moa.gov.tw
```

### Q3: 分頁問題（資料筆數不完整）
**症狀：** 期望 1000 筆，但只取得 100 筆
**原因：** API 預設每頁 100 筆，有分頁 (Next=true)
**解決：** `fetch_with_fallback.py` 自動處理分頁

---

## 🔌 整合到現有系統

### 修改 fetch_prices.py（推薦方案）

```python
# 使用新的回溯版本（預設開啟）
python -m etl.fetch_prices

# 不使用回溯
python -m etl.fetch_prices --no-fallback

# 指定日期和回溯天數
export LOOKBACK_DAYS=5
python -m etl.fetch_prices --date 2026-04-20
```

### 直接調用 fetch_with_fallback

```python
from etl.fetch_with_fallback import fetch_crop_with_fallback
import os

records, status, actual_date = fetch_crop_with_fallback(
    target=some_date,
    crop_code="N00100",
    api_key=os.environ["MOA_API_KEY"],
    max_lookback=3,
    verbose=True
)

if status == "ok":
    # 插入資料庫或後續處理
    save_to_db(records, actual_date)
else:
    print(f"警告：無法取得 {crop_code} 資料")
```

---

## 📋 驗證清單

執行以下檢查，確保全部就緒：

- [ ] MOA_API_KEY 已正確設定
- [ ] `./test_api.sh` 可成功執行
- [ ] Postman 集合已匯入並可發送請求
- [ ] `python example_fallback.py` 能執行
- [ ] 理解民國年轉換公式（年 - 1911）
- [ ] 瞭解常用作物代號（N00100=白菜, N01600=蕃茄 等）
- [ ] 能識別 API 成功 / 無資料 / 錯誤的回應

---

## 📚 文檔關鍵路徑

| 需求 | 文檔 |
|------|------|
| 快速開始 | **QUICK_START.md** |
| 完整測試指南 | **API_TESTING_GUIDE.md** |
| 方案總覽 | **API_TEST_SOLUTION.md**（本檔） |
| 自動回溯源碼 | [etl/fetch_with_fallback.py](etl/fetch_with_fallback.py) |
| 改進的日常抓取 | [etl/fetch_prices.py](etl/fetch_prices.py) |
| Postman 集合 | [postman_collection.json](postman_collection.json) |
| Shell 測試 | [test_api.sh](test_api.sh) |
| Python 示例 | [example_fallback.py](example_fallback.py) |

---

## 🎯 下一步建議

### 第 1 步（驗證）
執行 `./test_api.sh` 驗證 API 連接正常

### 第 2 步（理解）
閱讀 **QUICK_START.md** 瞭解基本概念

### 第 3 步（測試）
用 Postman 或 Python 手動測試幾個查詢

### 第 4 步（整合）
根據你的需求選擇集成方式：
- **自動日常抓取**：使用改進的 `fetch_prices.py`
- **自訂邏輯**：導入 `fetch_with_fallback` 模組
- **即席查詢**：用 Postman 或 curl

### 第 5 步（上線）
- 設定環境變數 `MOA_API_KEY` 和 `LOOKBACK_DAYS`
- 在 cron job 或調度系統中執行
- 監控日誌和資料品質

---

## 💡 最佳實踐

1. **環境變數**
   ```bash
   export MOA_API_KEY='...'        # 必填
   export LOOKBACK_DAYS=3           # 可選，預設 3
   ```

2. **錯誤處理**
   ```python
   if status == "ok":
       save_records(records, actual_date)
   elif status == "empty":
       log_warning(f"No data for {target_date}")
   else:
       log_error(f"API error: {status}")
   ```

3. **日誌記錄**
   - 記錄目標日期和實際日期
   - 記錄查詢到的筆數
   - 記錄所有錯誤和警告

4. **延遲控制**
   - API 請求間隔設置為 0.3 秒（已內建）
   - 避免對伺服器造成負擔

5. **監控告警**
   - 監控連續多天無資料的情況
   - 定期檢查 API 服務狀態
   - 設置告警門檻（e.g., 回溯超過 3 天）

---

**最後更新：2026-04-20**
**相關連結：** [農業部開放資料](https://data.moa.gov.tw) | [API 文檔](https://data.moa.gov.tw)
