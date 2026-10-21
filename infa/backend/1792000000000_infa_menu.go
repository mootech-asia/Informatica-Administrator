package version_local

import (
	"fmt"
	"runtime"

	"gorm.io/gorm"

	"go-admin/app/admin/models"
	"go-admin/cmd/migrate/migration"
	common "go-admin/common/models"
)

// INFA 監控後台的選單。
//
// 側邊欄只留兩大項：
//
//	系統工具 → 六個區域 → 各監控子項目（點進去就是該系統）
//	系統設置 → 用戶管理、角色管理、選單管理
//
// 其餘 go-admin 內建選單（部門、崗位、字典、日誌、定時任務、開發工具…）
// 以軟刪除移除，否則它們會出現在「角色管理」的選單權限樹裡。對應的後端
// API 仍在，只是沒有入口；要找回來，把 sys_menu.deleted_at 改回 0 即可。
//
// 帳號能看到哪些子項目，用 go-admin 原本的「角色管理 → 選單權限」勾選；
// 帳號再指定角色即可。
//
// 子項目的網址：在「選單管理」把該子項目的「路由地址」改成 https:// 開頭的
// 網址，側邊欄就會直接以新分頁開啟。還沒有網址前，先顯示 /infa/link 佔位頁。
func init() {
	_, fileName, _, _ := runtime.Caller(0)
	migration.Migrate.SetVersion(migration.GetFilename(fileName), _1792000000000InfaMenu)
}

const (
	sysAdminMenuId = 2   // 系统管理 → 系統設置
	sysUserMenuId  = 3   // 用户管理
	sysMenuMenuId  = 51  // 菜单管理
	sysRoleMenuId  = 52  // 角色管理
	sysToolsMenuId = 537 // 系统工具
)

type infaRegion struct {
	key   string // 路由片段
	title string
	items []string
}

var infaRegions = []infaRegion{
	{"twidc", "TWIDC", []string{"Cacti", "Zabbix", "WAN PRTG", "LAN PRTG", "Ext PRTG", "Graylog", "Graylog2", "Looking glass", "Streaming wall", "haproxystat", "NTOP", "Wazuh"}},
	{"jpidc", "JPIDC", []string{"Cacti", "Zabbix", "PRTG", "Graylog"}},
	{"phidc", "PHIDC", nil},
	{"ph-office", "PH Office", nil},
	{"ph-studio", "PH Studio", nil},
	{"sl-office", "SL Office", nil},
}

// infaRegionMenuId returns 10100, 10200, ... ; its items are +1, +2, ...
func infaRegionMenuId(i int) int { return 10000 + (i+1)*100 }

func _1792000000000InfaMenu(db *gorm.DB, version string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		keepPages := []int{sysUserMenuId, sysMenuMenuId, sysRoleMenuId}
		keep := append([]int{sysAdminMenuId, sysToolsMenuId}, keepPages...)

		// ---- 1. 移除其他選單 ----
		// 保留的頁面底下的按鈕權限（新增、修改、刪除…）要留著。
		if err := tx.
			Where("menu_id < ? AND menu_id NOT IN ?", 10000, keep).
			Where("NOT (menu_type = ? AND parent_id IN ?)", "F", keepPages).
			Delete(&models.SysMenu{}).Error; err != nil {
			return err
		}

		// ---- 2. 保留的選單改名、排序 ----
		renames := map[int]map[string]interface{}{
			sysToolsMenuId: {"title": "系統工具", "icon": "monitor", "sort": 1, "visible": "0", "paths": "/0/537"},
			sysAdminMenuId: {"title": "系統設置", "icon": "system", "sort": 2, "visible": "0"},
			sysUserMenuId:  {"title": "用戶管理", "sort": 1, "visible": "0"},
			sysRoleMenuId:  {"title": "角色管理", "sort": 2, "visible": "0"},
			sysMenuMenuId:  {"title": "選單管理", "sort": 3, "visible": "0"},
		}
		for id, cols := range renames {
			if err := tx.Model(&models.SysMenu{}).Where("menu_id = ?", id).Updates(cols).Error; err != nil {
				return err
			}
		}

		// ---- 3. 區域與子項目 ----
		ids := []int{}
		for i, r := range infaRegions {
			rid := infaRegionMenuId(i)
			dir := models.SysMenu{
				MenuId: rid, MenuName: "Infa" + fmt.Sprint(rid), Title: r.title, Icon: "server",
				Path: "/sys-tools/" + r.key, Paths: fmt.Sprintf("/0/%d/%d", sysToolsMenuId, rid),
				MenuType: "M", ParentId: sysToolsMenuId, Component: "/infa/region/index",
				Sort: i + 1, Visible: "0", IsFrame: "1",
			}
			if err := upsertMenu(tx, &dir); err != nil {
				return err
			}
			ids = append(ids, rid)
			for j, name := range r.items {
				mid := rid + j + 1
				item := models.SysMenu{
					MenuId: mid, MenuName: "Infa" + fmt.Sprint(mid), Title: name, Icon: "link",
					Path: fmt.Sprintf("/sys-tools/%s/%d", r.key, mid), Paths: fmt.Sprintf("%s/%d", dir.Paths, mid),
					MenuType: "C", ParentId: rid, Component: "/infa/link/index",
					Sort: j + 1, Visible: "0", IsFrame: "1",
				}
				if err := upsertMenu(tx, &item); err != nil {
					return err
				}
				ids = append(ids, mid)
			}
		}

		// ---- 4. 授權給 admin 角色 ----
		var role models.SysRole
		if err := tx.Where("role_key = ?", "admin").First(&role).Error; err == nil {
			for _, id := range append(ids, sysToolsMenuId) {
				if err := tx.Exec(
					"INSERT INTO sys_role_menu (role_id, menu_id) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM sys_role_menu WHERE role_id = ? AND menu_id = ?)",
					role.RoleId, id, role.RoleId, id,
				).Error; err != nil {
					return err
				}
			}
		} else if err != gorm.ErrRecordNotFound {
			return err
		}

		// ---- 5. 系統名稱 ----
		if err := tx.Exec("UPDATE sys_config SET config_value = ? WHERE config_key = ?", "INFA 監控後台", "sys_app_name").Error; err != nil {
			return err
		}

		return tx.Create(&common.Migration{Version: version}).Error
	})
}

// upsertMenu inserts the menu, or overwrites it when the id already exists,
// so re-running the migration on a database that has it is harmless.
func upsertMenu(tx *gorm.DB, m *models.SysMenu) error {
	var n int64
	if err := tx.Model(&models.SysMenu{}).Where("menu_id = ?", m.MenuId).Count(&n).Error; err != nil {
		return err
	}
	if n == 0 {
		return tx.Create(m).Error
	}
	return tx.Model(&models.SysMenu{}).Where("menu_id = ?", m.MenuId).Select("*").Omit("created_at", "create_by").Updates(m).Error
}
