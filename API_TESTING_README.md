# 🌾 農業部菜價 API 測試和自動回溯方案

完整的 API 測試解決方案，包含 **Postman 集合、Shell 腳本、Python 模組**，以及**當日無數據自動回溯**功能。

---

## 📦 包含內容

### 📚 文檔
| 文檔 | 用途 |
|------|------|
| [QUICK_START.md](QUICK_START.md) | ⚡ 30 秒快速上手 |
| [API_TESTING_GUIDE.md](API_TESTING_GUIDE.md) | 📖 完整詳細指南 |
| [API_TEST_SOLUTION.md](API_TEST_SOLUTION.md) | 🎯 方案設計與比較 |

### 🛠️ 工具
| 工具 | 描述 | 使用場景 |
|------|------|--------|
| [postman_collection.json](postman_collection.json) | Postman 測試集合 | GUI 測試、團隊協作 |
| [test_api.sh](test_api.sh) | Shell 快速測試腳本 | 快速驗證、自動化 |
| [example_fallback.py](example_fallback.py) | Python 完整示例 | 學習、開發參考 |

### 🔧 核心模組
| 模組 | 功能 |
|------|------|
| [etl/fetch_with_fallback.py](etl/fetch_with_fallback.py) | 自動回溯 API 查詢（新增） |
| [etl/fetch_prices.py](etl/fetch_prices.py) | 日常抓取腳本（已改進） |

---

## 🚀 快速開始

### 1️⃣ 設定環境
```bash
export MOA_API_KEY='your_api_key_here'
```

### 2️⃣ 選擇測試方式

#### 方式 A：Shell 腳本（推薦）
```bash
chmod +x test_api.sh
./test_api.sh
```

#### 方式 B：Postman（GUI）
1. Postman → Import → 選擇 `postman_collection.json`
2. 設定環境變數
3. 點擊 Send

#### 方式 C：Python（靈活）
```bash
python example_fallback.py
```

### 3️⃣ 整合到代碼
```python
from etl.fetch_with_fallback import fetch_crop_with_fallback
from datetime import date

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

## ✨ 核心功能

### ✅ 自動回溯邏輯
```
查詢目標日期 
    → 無資料 
    → 往回查前一日 
    → 找到資料或達到回溯上限
```

### ✅ 支持多種查詢模式
- 單日查詢
- 日期區間查詢
- 自動回溯查詢（可設定往回天數）
- 多品項批量查詢

### ✅ 時間參數自動轉換
西元年 ↔ 民國年（e.g., 2026-04-20 ↔ 115.04.20）

---

## 📊 API 時間參數

農業部 API 使用**民國年**格式：

| 西元年 | 民國年 | 說明 |
|--------|--------|------|
| 2026-04-20 | 115.04.20 | 今日（公式：年 - 1911） |
| 2025-01-01 | 114.01.01 | 新年 |
| 2024-12-31 | 113.12.31 | 跨年 |

---

## 📋 使用場景

### 📱 產品經理 / QA
**使用工具：** Postman 集合
- 點擊即用的 GUI 界面
- 可視化檢查 API 回應
- 易於分享和協作

### 🐧 後端開發 / DevOps
**使用工具：** Shell 腳本 + Python 模組
- `./test_api.sh` 快速驗證
- 整合到 cron job 或自動化流程
- 環境變數配置靈活

### 📊 資料工程 / 分析師
**使用工具：** Python 模組 `fetch_with_fallback`
- 自訂回溯邏輯
- 支持複雜查詢
- 易於與資料管道集成

---

## 🔍 故障排查

### 問題 1：401 Unauthorized
```bash
# 檢查 API Key
echo $MOA_API_KEY

# 重新設定
export MOA_API_KEY='correct_key'
```

### 問題 2：所有日期都無資料
```bash
# 試試其他品項
curl "...&CropCode=N01600&..."

# 查詢其他日期
curl "...&Start_time=115.04.14&End_time=115.04.20&..."
```

### 問題 3：分頁問題
模組已自動處理分頁，無需手動干預

---

## 📚 常用作物代號

| 品項 | 代號 | 品項 | 代號 |
|------|------|------|------|
| 白菜 | N00100 | 青蔥 | N02700 |
| 甘藍 | N00300 | 洋蔥 | N02000 |
| 蕃茄 | N01600 | 黃瓜 | N01700 |

完整清單見 `etl/crops.yaml`

---

## 💻 系統要求

- Python 3.8+
- `requests` 庫（已在專案中）
- cURL（可選，用於 Shell 腳本）
- Postman（可選，用於 GUI 測試）

---

## 🎯 建議的使用流程

```
第 1 步：驗證連接
        ↓
    ./test_api.sh
        ↓
第 2 步：理解邏輯
        ↓
    閱讀 QUICK_START.md
        ↓
第 3 步：測試查詢
        ↓
    用 Postman 或 Python 手動測試
        ↓
第 4 步：整合代碼
        ↓
    導入 fetch_with_fallback 或修改 fetch_prices.py
        ↓
第 5 步：上線部署
        ↓
    設定環境變數，在生產環境執行
```

---

## 📞 支持

- **問題排查**：見 [API_TESTING_GUIDE.md](API_TESTING_GUIDE.md) 的「故障排除」
- **快速參考**：見 [QUICK_START.md](QUICK_START.md)
- **詳細設計**：見 [API_TEST_SOLUTION.md](API_TEST_SOLUTION.md)
- **源碼**：[etl/fetch_with_fallback.py](etl/fetch_with_fallback.py)

---

## 📝 更新日誌

### 2026-04-20
- ✨ 新增自動回溯模組
- ✨ 新增 Postman 集合
- ✨ 新增 Shell 測試腳本
- 📖 完善文檔和示例
- ✅ 改進 `fetch_prices.py` 集成回溯邏輯

---

## 📄 授權

MIT License - 詳見 LICENSE 檔案

---

**讓測試更簡單，讓數據更準確。** 🚀
