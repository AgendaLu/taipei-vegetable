# API 測試和自動回溯指南

## 概述

農業部菜價 API 時常當日無數據，此指南協助你：
1. 用 Postman 測試 API（驗證 Start_Time & End_Time）
2. 實現自動回溯邏輯（當日無數據自動查前一日）

---

## 一、Postman 測試

### 1.1 匯入集合

將 `postman_collection.json` 匯入 Postman：
1. 開啟 Postman
2. 點擊 **Import** → 選擇 `postman_collection.json` 檔案
3. 集合會自動建立

### 1.2 配置環境變數

在 Postman 中設定以下變數：

| 變數名 | 說明 | 範例 |
|--------|------|------|
| `MOA_API_KEY` | 農業部 API Key | 從環境變數取得或手動設定 |
| `today_minguo` | 今日（民國年格式） | `115.04.20` |
| `yesterday_minguo` | 前一日（民國年格式） | `115.04.19` |
| `start_date_minguo` | 起始日期（民國年格式） | `115.04.01` |
| `end_date_minguo` | 結束日期（民國年格式） | `115.04.15` |

**民國年計算公式：** `民國年 = 西元年 - 1911`

例如：
- 2026-04-20 → 115.04.20
- 2025-01-01 → 114.01.01

### 1.3 測試範例

#### 查詢今日白菜資料
```
GET https://data.moa.gov.tw/api/v1/AgriProductsTransType/
?apikey=YOUR_API_KEY
&format=json
&CropCode=N00100
&Start_time=115.04.20
&End_time=115.04.20
&Page=1
```

**預期結果：**
- ✓ 有資料：`"RS":"OK"` + `"Data":[...]`
- – 無資料：`"RS":"OK"` + `"Data":[]`
- ✗ 錯誤：`"RS":"ERROR"` 或其他錯誤訊息

#### 回溯查詢（當日無數據時）
```
GET https://data.moa.gov.tw/api/v1/AgriProductsTransType/
?apikey=YOUR_API_KEY
&format=json
&CropCode=N00100
&Start_time=115.04.19
&End_time=115.04.19
&Page=1
```

### 1.4 常見問題排查

| 問題 | 可能原因 | 解決方案 |
|------|--------|--------|
| 401 Unauthorized | API Key 錯誤 | 驗證 MOA_API_KEY |
| 所有日期都無資料 | 該品項確實無數據 | 嘗試其他作物代號 |
| 連線逾時 | 伺服器繁忙 | 等待 1-2 分鐘後重試 |
| `"RS":"ERROR"` | API 伺服器問題 | 檢查農業部服務狀態 |

---

## 二、自動回溯邏輯

### 2.1 使用新的 fetch_with_fallback 模組

```python
from etl.fetch_with_fallback import fetch_crop_with_fallback
from datetime import date

records, status, actual_date = fetch_crop_with_fallback(
    target=date(2026, 4, 20),
    crop_code="N00100",  # 白菜
    api_key="YOUR_API_KEY",
    max_lookback=3,      # 最多往回查 3 天
    verbose=True         # 印出查詢過程
)

if status == "ok":
    print(f"✓ 取得 {len(records)} 筆資料")
    print(f"  實際日期：{actual_date}")
else:
    print(f"✗ 查詢失敗：{status}")
```

### 2.2 返回值說明

- **records**: 取得的資料清單（陣列）
- **status**: 
  - `"ok"` - 成功取得資料
  - `"empty"` - 在指定範圍內無資料
  - `"error: ..."` - API 錯誤或網路問題
- **actual_date**: 實際取得資料的日期（若無資料則為 None）

### 2.3 作物代號參考

常用作物代號：
| 品項 | 代號 |
|------|------|
| 白菜 | N00100 |
| 蕃茄 | N01600 |
| 洋蔥 | N02000 |
| 甘藍 | N00300 |

查詢完整清單，請檢視 `etl/crops.yaml`

---

## 三、整合到 fetch_prices.py

### 3.1 修改 run_daily 函數

使用 `fetch_with_fallback` 取代原本的 `fetch_crop_range`：

```python
from etl.fetch_with_fallback import fetch_crop_with_fallback

def run_daily(target: date) -> int:
    # ... 初始化代碼 ...
    
    try:
        for display_name, codes in CROP_CODES.items():
            for code in codes:
                # 使用回溯版本（預設往回查 3 天）
                records, status, actual_date = fetch_crop_with_fallback(
                    target=target,
                    crop_code=code,
                    api_key=API_KEY,
                    max_lookback=3,
                    verbose=False
                )
                
                # ... 後續邏輯保持不變 ...
```

### 3.2 靈活配置

在環境變數中設定回溯天數：

```bash
export LOOKBACK_DAYS=5  # 預設為 3
python -m etl.fetch_prices --date 2026-04-20
```

---

## 四、測試清單

運行以下檢查，確保一切正常：

- [ ] Postman 能正常連接 API
- [ ] 當日有資料的作物能正常查詢
- [ ] 當日無資料時能自動回溯到前一日
- [ ] 在超過回溯範圍時正確返回 "empty" 狀態
- [ ] 网络異常時能正確捕捉錯誤
- [ ] 分頁功能正常（資料筆數多於一頁）

---

## 五、故障排除

### 5.1 查看詳細日誌

```python
# 開啟 verbose 模式查看每一步
records, status, actual_date = fetch_crop_with_fallback(
    target=date(2026, 4, 20),
    crop_code="N00100",
    api_key="YOUR_API_KEY",
    max_lookback=5,
    verbose=True  # ← 關鍵
)
```

### 5.2 測試單日查詢

```python
from etl.fetch_with_fallback import fetch_single_day

# 只查詢特定一天
records, status, _ = fetch_single_day(
    target=date(2026, 4, 20),
    crop_code="N00100",
    api_key="YOUR_API_KEY"
)
print(f"Status: {status}, Records: {len(records)}")
```

### 5.3 檢查 API 響應

在 Postman 或 curl 中檢查原始響應：

```bash
curl -s "https://data.moa.gov.tw/api/v1/AgriProductsTransType/?apikey=YOUR_KEY&format=json&CropCode=N00100&Start_time=115.04.20&End_time=115.04.20&Page=1" | jq .
```

查看：
- `"RS"` 是否為 `"OK"`
- `"Data"` 是否為空陣列 `[]`
- 是否有 `"Next"` 欄位（分頁）

---

## 六、快速參考

| 用途 | 程式 | 指令 |
|------|------|------|
| 測試 API | Postman 或 curl | 導入 `postman_collection.json` |
| 當日抓取（有回溯） | `fetch_prices.py` | `python -m etl.fetch_prices` |
| 自訂回溯天數 | `fetch_with_fallback.py` | 見第 3.2 節 |
| 查看日誌 | `fetch_with_fallback.py` | 設定 `verbose=True` |

---

## 相關檔案

- `postman_collection.json` - Postman 測試集合
- `etl/fetch_with_fallback.py` - 自動回溯模組
- `etl/fetch_prices.py` - 日常抓取腳本
- `etl/crops.yaml` - 作物代號清單
