# 登入頁動畫版本紀錄

登入頁左半部的粒子波浪動畫：`go-admin-ui/src/components/ParticleWave/wave.js`（由 `infa/frontend.patch` 加入）。

- 每次改動動畫都升一個版本號，並在下方「版本」記下當時部署展示版的 commit（`claude/new-session-j8bred` 分支上）。
- 線上目前是哪一版：在登入頁按 F12，查看左半部 `<canvas>` 的 `data-version` 屬性。

## 還原到某一版

每一版記錄的 commit 裡，`infa/frontend.patch` 就是那一版的完整內容。例如還原到 v1.0：

```bash
git checkout 1be9bc9 -- infa/frontend.patch
git commit -m "Revert login animation to v1.0"
```

推上去之後執行「Deploy demo」workflow，展示版就會換回那一版。

## 版本

### v1.1（commit `aba531d`）

- 地面上加入光粒子：在地面隨機位置淡入，緩緩上升、輕微擺動並向外擴散，再淡出、換位置重新出現。近處的大而亮，遠處的小而淡。
- 漸層藍：地面和兩側光線束依位置分成 5 個色帶（近白亮青 → 亮青 → 天藍 → 寶藍 → 靛紫藍），背景漸層層次更多。
- 效能：色帶用純色分批繪製，不用漸層填色（漸層填色在無顯示卡的環境慢約 3 成）。每格仍幾乎不產生暫存資料，記憶體約 3 MB。

### v1.0（commit `1be9bc9`）

- 參考圖風格的粒子波浪：兩側光線束隆起並收進地平線光暈，地面點陣往消失點收束，前景散景光點緩慢漂浮。
- 流暢度與記憶體優化：每格幾乎不產生暫存資料（約 2 KB，原本約 2.2 MB），背景以 1/4 解析度快取，所有動作以經過時間計算，最高 60 fps，分頁隱藏時停止。
- 流速放慢、閃爍更淡，整體沉穩。
