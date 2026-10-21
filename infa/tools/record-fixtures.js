// 重新錄製展示版（GitHub Pages）用的 API 回應：go-admin-ui/src/demo/fixtures.json
//
// 前置：後端與前端都在本機跑著，且已建立展示資料（TW 維運角色、demo 帳號，見 infa/README.md）。
// 用法：BASE=http://127.0.0.1:9527/ node infa/tools/record-fixtures.js go-admin-ui/src/demo/fixtures.json
// 需要 playwright（npm i -D playwright）。
//
// 以 admin、demo 兩個帳號點過每個頁面、開過每個對話框，記下所有 GET /api/v1/* 的 JSON 回應。
const { chromium } = require('playwright')
const fs = require('fs')

const BASE = process.env.BASE || 'http://127.0.0.1:9527/'
const out = process.argv[2]
if (!out) {
  console.error('用法：node infa/tools/record-fixtures.js <輸出檔>')
  process.exit(1)
}

const fixtures = {}

;(async () => {
  const browser = await chromium.launch()

  const session = async (username, password, steps) => {
    const set = fixtures[username] = {}
    const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, locale: 'zh-TW' })
    page.on('response', async res => {
      const url = new URL(res.url())
      if (!url.pathname.startsWith('/api/v1/') || res.request().method() !== 'GET') return
      if (!(res.headers()['content-type'] || '').includes('json')) return
      const query = [...url.searchParams.entries()].sort().map(([k, v]) => `${k}=${v}`).join('&')
      try {
        set[url.pathname + (query ? '?' + query : '')] = await res.json()
      } catch {}
    })

    await page.goto(BASE + '#/login', { waitUntil: 'networkidle' })
    const inputs = await page.locator('input').all()
    await inputs[0].fill(username)
    await inputs[1].fill(password)
    await inputs[2].fill('1234')
    await page.keyboard.press('Enter')
    await page.waitForURL(/dashboard/)
    await page.waitForTimeout(1500)

    const go = async hash => {
      await page.evaluate(h => { location.hash = h }, hash)
      await page.waitForTimeout(2000)
    }
    // 打開某列（row 為 null 時是工具列）的按鈕，等資料載入後關掉
    const dialog = async (row, label) => {
      const scope = row ? page.locator('.el-table__row').filter({ hasText: row }) : page.locator('.el-card')
      await scope.getByRole('button').filter({ hasText: label }).first().click({ timeout: 4000 })
        .catch(() => console.warn('找不到按鈕', row, label))
      await page.waitForTimeout(1500)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(600)
    }

    await steps(go, dialog)
    await page.close()
  }

  await session('admin', '123456', async (go, dialog) => {
    await go('/profile/index')
    await go('/admin/sys-user')
    await dialog(null, '新增')
    await dialog('demo', '修改')
    await dialog('admin', '修改')
    await go('/admin/sys-role')
    await dialog(null, '新增')
    await dialog('TW 維運', '修改')
    await dialog('系统管理员', '修改')
    await dialog('TW 維運', '数据权限')
    await go('/admin/sys-menu')
    await dialog(null, '新增')
    await go('/dashboard')
  })

  await session('demo', 'demo1234', async go => {
    await go('/profile/index')
    await go('/dashboard')
  })

  fs.writeFileSync(out, JSON.stringify(fixtures))
  for (const user in fixtures) console.log(user, Object.keys(fixtures[user]).length, 'responses')
  await browser.close()
})()
