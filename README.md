# INFA 監控後台

基礎架構監控的統一入口，以開源後台框架 [go-admin](https://github.com/go-admin-team/go-admin)（Go + Vue 3 / Element Plus）為基礎客製。

- **展示版**（不需後端，可直接點）：https://mootech-asia.github.io/Informatica-Administrator/
  帳號 `admin / 123456`（管理員）、`demo / demo1234`（只開部分項目）
- **開發與部署說明**：[infa/README.md](infa/README.md)

側邊欄只有兩大項：

| 系統工具 | 系統設置 |
|---|---|
| TWIDC、JPIDC、PHIDC、PH Office、PH Studio、SL Office 六區，點開是各監控子項目 | 用戶管理、角色管理（勾選可看的子項目）、選單管理（新增子項目、設定網址） |

![首頁](infa/screens/02-home-admin.png)

這個 repo 只放 INFA 的客製內容；go-admin 原始碼由 `scripts/setup.sh` 取得固定版本後套用：

```
infa/backend/1792000000000_infa_menu.go   選單與權限（go-admin migration）
infa/frontend.patch                        前端修改（首頁、子項目頁、展示模式…）
infa/tools/record-fixtures.js              重新錄製展示版資料
infa/screens/                              畫面截圖
scripts/setup.sh                           取得 go-admin 並套用以上內容
```
