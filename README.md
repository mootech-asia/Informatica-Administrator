# INFA 監控後台

統一的基礎架構監控入口：登入後依區域（TWIDC、JPIDC、PHIDC、PH Office、PH Studio、SL Office）列出各監控子項目（Cacti、Zabbix、PRTG、Graylog…），點擊即開啟該系統。

## 功能

- **登入介面**：帳號密碼登入（scrypt 雜湊、HttpOnly Session Cookie、登入失敗次數限制）
- **主畫面**：六個區域卡片，每區列出 Location / Name，點擊開新分頁進入該系統；支援搜尋
- **權限設置**（右上角，僅管理員可見）
  - 帳號管理：建立帳號與密碼、重設密碼、設定角色、刪除帳號
  - 以勾選清單設定每個帳號可看到的子項目（可整區全選）
  - 子項目管理：新增 / 編輯 / 刪除子項目，設定各子項目的登入網址
- 一般使用者只會看到被授權的子項目（伺服器端強制過濾）
- 所有使用者皆可自行修改密碼

## 執行

需要 Node.js 18 以上，無其他相依套件。

```bash
ADMIN_PASSWORD='請改成強密碼' npm start
# 開啟 http://localhost:3000 ，以 admin 登入
```

首次啟動會建立 `data/db.json` 與管理員帳號；若未設定 `ADMIN_PASSWORD`，會產生隨機密碼並印在主控台。

| 環境變數 | 預設 | 說明 |
|---|---|---|
| `PORT` | `3000` | 監聽埠 |
| `HOST` | `0.0.0.0` | 監聽位址 |
| `DATA_DIR` | `./data` | 資料存放目錄 |
| `ADMIN_USER` | `admin` | 初始管理員帳號 |
| `ADMIN_PASSWORD` | 隨機 | 初始管理員密碼（僅首次啟動使用） |
| `COOKIE_SECURE` | 未設定 | 設為 `1` 時 Cookie 加上 `Secure`（走 HTTPS 時建議開啟） |

正式環境建議放在 Nginx 等反向代理之後並啟用 HTTPS。

## 待補

- PHIDC、PH Office、PH Studio、SL Office 的子項目（可直接在「權限設置 → 子項目管理」新增）
- 各子項目的登入網址 / 登入畫面
