# 快速開始指南

## 🚀 30 秒快速上手

### 1️⃣ 設定 API Key
```bash
export MOA_API_KEY='your_api_key_here'
```

### 2️⃣ 用 Shell 腳本快速測試
```bash
# 執行自動測試（包括回溯邏輯）
./test_api.sh
```

### 3️⃣ 用 Python 查詢資料（自動回溯）
```python
from etl.fetch_with_fallback import fetch_crop_with_fallback
from datetime import date

records, status, actual_date = fetch_crop_with_fallback(
    target=date.today(),      # 目標日期
    crop_code="N00100",       # 白菜
    api_key="YOUR_API_KEY",
    max_lookback=3            # 最多往回查 3 天
)

if status == "ok":
    print(f"✓ 取得 {len(records)} 筆資料（日期：{actual_date}）")
```

---

## 📊 常用作物代號

| 品項 | 代號 | 品項 | 代號 |
|------|------|------|------|
| 白菜 | N00100 | 洋蔥 | N02000 |
| 甘藍 | N00300 | 青蔥 | N02700 |
| 大白菜 | N00200 | 蕃茄 | N01600 |

---

## 🔍 3 種測試方式

### 方式 A：Postman（GUI）
1. 匯入 `postman_collection.json`
2. 設定環境變數（API Key、日期）
3. 點擊「Send」

### 方式 B：Shell 腳本（快速）
```bash
./test_api.sh
```
自動查詢多個日期和品項，支持回溯

### 方式 C：Python 腳本（靈活）
```bash
python example_fallback.py
```
完整示例：基本查詢、回溯、多品項對比

---

## ⚡ 常見用法

### 查詢當日資料（有回溯）
```python
from etl.fetch_with_fallback import fetch_crop_with_fallback
from datetime import date

records, status, actual_date = fetch_crop_with_fallback(
    target=date(2026, 4, 20),
    crop_code="N00100",
    api_key=os.environ["MOA_API_KEY"],
    max_lookback=3,
    verbose=True
)
```

### 查詢單日（無回溯）
```python
from etl.fetch_with_fallback import fetch_single_day

records, status, _ = fetch_single_day(
    target=date(2026, 4, 20),
    crop_code="N00100",
    api_key=os.environ["MOA_API_KEY"]
)
```

### 日期轉換（西元 → 民國）
```python
from etl.fetch_with_fallback import to_minguo

minguo = to_minguo(date(2026, 4, 20))  # "115.04.20"
```

---

## 📋 檢查清單

- [ ] MOA_API_KEY 已設定
- [ ] 可以用 `./test_api.sh` 測試
- [ ] Postman 集合已匯入
- [ ] 瞭解民國年轉換公式（年 - 1911）

---

## 🐛 排查

| 問題 | 解決方案 |
|------|--------|
| 找不到 MOA_API_KEY | `echo $MOA_API_KEY` 檢查是否已設定 |
| curl 命令找不到 | `brew install curl` 或使用 Postman |
| 所有日期都無資料 | 嘗試其他作物代號或檢查 API 服務 |
| Python ImportError | 確保在專案根目錄執行 |

---

## 📚 詳細文檔

- **API_TESTING_GUIDE.md** - 完整測試指南
- **etl/fetch_with_fallback.py** - 原始碼（含說明文件）
- **example_fallback.py** - 5 個完整示例

---

## 回溯邏輯流程圖

```
查詢目標日期
    ↓
有資料？ → 是 → ✓ 返回
    ↓ 否
往回 1 天
    ↓
有資料？ → 是 → ✓ 返回（實際日期已更新）
    ↓ 否
往回 2 天
    ↓
有資料？ → 是 → ✓ 返回
    ↓ 否
... 重複直到達到 max_lookback ...
    ↓
✗ 返回 empty
```

---

## API 回應解讀

### 成功（有資料）
```json
{
  "RS": "OK",
  "Data": [
    {
      "TransDate": "20260420",
      "MarketName": "台北一",
      "CropName": "白菜",
      "TransQty": 1234,
      "AvgPrice": 5.5
    }
  ],
  "Next": false
}
```

### 無資料
```json
{
  "RS": "OK",
  "Data": [],
  "Next": false
}
```

### 錯誤
```json
{
  "RS": "ERROR",
  "RtnCode": 400
}
```

---

## 民國年快速換算

| 西元 | 民國 | 西元 | 民國 |
|------|------|------|------|
| 2024 | 113 | 2025 | 114 |
| 2026 | 115 | 2027 | 116 |

**公式：** 民國 = 西元 - 1911

---

## 下一步

1. ✅ 用 `test_api.sh` 驗證 API 連接
2. ✅ 用 Postman 手動測試幾個查詢
3. ✅ 執行 `python example_fallback.py` 查看完整示例
4. ✅ 根據需求整合回溯邏輯到你的代碼

---

**需要幫助？** 參考 `API_TESTING_GUIDE.md` 的「故障排除」章節。
