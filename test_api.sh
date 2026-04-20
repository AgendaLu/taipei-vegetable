#!/bin/bash
# test_api.sh - 快速測試農業部菜價 API

set -e

# 顏色定義
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 檢查環境變數
if [ -z "$MOA_API_KEY" ]; then
    echo -e "${RED}✗ 未設定 MOA_API_KEY 環境變數${NC}"
    echo "  用法：export MOA_API_KEY='your_api_key'"
    exit 1
fi

API_BASE="https://data.moa.gov.tw/api/v1/AgriProductsTransType/"

# 轉換西元年為民國年
iso_to_minguo() {
    local date_str=$1  # YYYY-MM-DD
    local year=$(echo $date_str | cut -d'-' -f1)
    local month=$(echo $date_str | cut -d'-' -f2)
    local day=$(echo $date_str | cut -d'-' -f3)

    local minguo_year=$((year - 1911))
    printf "%d.%s.%s" $minguo_year $month $day
}

# 查詢指定日期和作物
query_api() {
    local date=$1
    local crop_code=$2
    local crop_name=$3

    local minguo=$(iso_to_minguo "$date")

    echo -e "${BLUE}▶ 查詢 $date ($minguo) - $crop_name ($crop_code)${NC}"

    response=$(curl -s -w "\n%{http_code}" \
        "${API_BASE}?apikey=${MOA_API_KEY}&format=json&CropCode=${crop_code}&Start_time=${minguo}&End_time=${minguo}&Page=1")

    http_code=$(echo "$response" | tail -1)
    body=$(echo "$response" | head -n -1)

    # 檢查 HTTP 狀態碼
    if [ "$http_code" != "200" ]; then
        echo -e "${RED}✗ HTTP $http_code${NC}"
        return 1
    fi

    # 檢查 API 回應狀態
    rs=$(echo "$body" | jq -r '.RS' 2>/dev/null || echo "PARSE_ERROR")

    if [ "$rs" != "OK" ]; then
        echo -e "${RED}✗ API RS=$rs${NC}"
        echo "Response: $body"
        return 1
    fi

    # 統計資料筆數
    data_count=$(echo "$body" | jq '.Data | length' 2>/dev/null || echo "0")

    if [ "$data_count" -eq 0 ]; then
        echo -e "${YELLOW}– 無資料${NC}"
        return 0
    fi

    echo -e "${GREEN}✓ 成功：$data_count 筆${NC}"

    # 顯示首筆資料範例
    echo "$body" | jq -r '.Data[0] | "  市場: \(.MarketName) | 品項: \(.CropName) | 交易量: \(.TransQty) | 平均價: \(.AvgPrice)"' 2>/dev/null || true

    return 0
}

# 回溯查詢（當日無數據時）
query_with_fallback() {
    local date=$1
    local crop_code=$2
    local crop_name=$3
    local max_days=$4

    echo -e "${BLUE}▶ 查詢 $crop_name ($crop_code) - 如無資料則回溯（最多 $max_days 天）${NC}"

    current_date=$date
    for ((i=0; i<=max_days; i++)); do
        minguo=$(iso_to_minguo "$current_date")

        response=$(curl -s -w "\n%{http_code}" \
            "${API_BASE}?apikey=${MOA_API_KEY}&format=json&CropCode=${crop_code}&Start_time=${minguo}&End_time=${minguo}&Page=1")

        http_code=$(echo "$response" | tail -1)
        body=$(echo "$response" | head -n -1)

        if [ "$http_code" != "200" ]; then
            echo -e "${RED}✗ HTTP $http_code (日期: $current_date)${NC}"
            return 1
        fi

        rs=$(echo "$body" | jq -r '.RS' 2>/dev/null || echo "PARSE_ERROR")
        if [ "$rs" != "OK" ]; then
            echo -e "${RED}✗ API RS=$rs${NC}"
            return 1
        fi

        data_count=$(echo "$body" | jq '.Data | length' 2>/dev/null || echo "0")

        if [ "$data_count" -gt 0 ]; then
            echo -e "${GREEN}✓ 找到資料（日期: $current_date）: $data_count 筆${NC}"
            echo "$body" | jq -r '.Data[0] | "  市場: \(.MarketName) | 品項: \(.CropName) | 交易量: \(.TransQty) | 平均價: \(.AvgPrice)"' 2>/dev/null || true
            return 0
        fi

        echo -e "${YELLOW}– 無資料（日期: $current_date），往回查詢${NC}"

        # 往前一天
        current_date=$(date -j -f "%Y-%m-%d" -v-1d "$current_date" 2>/dev/null || date -d "$current_date - 1 day" +"%Y-%m-%d" 2>/dev/null)
        sleep 0.3
    done

    echo -e "${RED}✗ 在 $max_days 天內未找到資料${NC}"
    return 1
}

# === 主程式 ===

echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo "農業部菜價 API 測試"
echo -e "${BLUE}═══════════════════════════════════════════${NC}\n"

# 取得今日日期
today=$(date +"%Y-%m-%d")
yesterday=$(date -j -f "%Y-%m-%d" -v-1d "$today" 2>/dev/null || date -d "$today - 1 day" +"%Y-%m-%d" 2>/dev/null)

echo "今日：$today"
echo "前一日：$yesterday"
echo ""

# 測試作物代號
echo -e "${BLUE}【測試 1：查詢今日白菜資料】${NC}"
query_api "$today" "N00100" "白菜" || true
echo ""

echo -e "${BLUE}【測試 2：查詢今日蕃茄資料】${NC}"
query_api "$today" "N01600" "蕃茄" || true
echo ""

echo -e "${BLUE}【測試 3：自動回溯（最多 3 天）】${NC}"
query_with_fallback "$today" "N00100" "白菜" 3 || true
echo ""

echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}測試完成${NC}"
echo -e "${BLUE}═══════════════════════════════════════════${NC}"
