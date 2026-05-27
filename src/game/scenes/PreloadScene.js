import Phaser from 'phaser'

const BUILD = '2026-05-27-D'

// Send log to browser console AND to npm terminal via /_log relay
function tlog(...args) {
  console.log(...args)
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
  fetch('http://localhost:3000/_log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: [msg] })
  }).catch(() => {})
}

export class PreloadScene extends Phaser.Scene {
  constructor() { super('PreloadScene') }

  preload() {
    tlog(`[Preload] ══ BUILD ${BUILD} ══`)

    this.load.on('loaderror', (file) => {
      tlog(`[Preload] ❌ LOAD ERROR: key="${file.key}"  url="${file.src}"`)
    })

    this.load.on('filecomplete', (key) => {
      tlog(`[Preload] ✓ loaded: ${key}`)
    })

    // Only levels with actual JSON files in public/levels/
    const TILED_LEVELS = [1]
    for (const i of TILED_LEVELS) {
      this.load.tilemapTiledJSON(`level${i}`, `/levels/level${i}.json`)
    }

    this.load.image('tilemap_packed',             '/levels/tilemap_packed.png')
    this.load.image('tilemap-backgrounds_packed', '/levels/tilemap-backgrounds_packed.png')
    // Extra tileset sheets (1.png … 5.png) — loaded with keys 'ts-1' … 'ts-5'
    // loaderror fires silently if a file is absent, so listing extras here is safe
    for (let i = 1; i <= 5; i++) {
      this.load.image(`ts-${i}`, `/levels/${i}.png`)
    }
    this.load.image('bg-tile', '/assets/bg-tile.png')
  }

  create() {
    const hasPng    = this.textures.exists('tilemap_packed')
    const hasLevel1 = this.cache.tilemap.exists('level1')

    tlog(`[Preload] create() — tilemap_packed=${hasPng}  level1=${hasLevel1}`)

    if (!hasPng)    tlog('[Preload] ❌ tilemap_packed.png НЕ загружен! Проверь public/levels/tilemap_packed.png')
    if (!hasLevel1) tlog('[Preload] ❌ level1.json НЕ загружен! Проверь public/levels/level1.json')

    // Players (no PNG yet — generated)
    const g = this.make.graphics({ x: 0, y: 0, add: false })

    g.fillStyle(0x4488ff); g.fillRect(2, 0, 16, 16)
    g.fillStyle(0x2266cc); g.fillRect(0, 14, 20, 20)
    g.fillStyle(0x88bbff); g.fillRect(5, 4, 5, 5)
    g.generateTexture('player-blue', 20, 34); g.clear()

    g.fillStyle(0xff8844); g.fillRect(2, 0, 16, 16)
    g.fillStyle(0xcc5522); g.fillRect(0, 14, 20, 20)
    g.fillStyle(0xffbb88); g.fillRect(5, 4, 5, 5)
    g.generateTexture('player-orange', 20, 34); g.clear()

    // Transparent 1×1 physics placeholders for ground/platforms
    // → NO visible color; tile layers from tilemap_packed.png provide all visuals
    g.generateTexture('tile-ground',   1, 1); g.clear()
    g.generateTexture('tile-platform', 1, 1); g.clear()

    // Game-object physics placeholders — transparent 1×1, NO visual.
    // Physics body sizes are set explicitly in GameScene via setDisplaySize().
    // Proper pixel-art sprites will replace these when ready.
    g.generateTexture('orb',   1, 1); g.clear()
    g.generateTexture('plate', 1, 1); g.clear()
    g.generateTexture('door',  1, 1); g.clear()
    g.generateTexture('sign',  1, 1); g.clear()

    g.destroy()

    tlog('[Preload] → starting GameScene')
    this.scene.start('GameScene', window.__l2s || { levelId: 1, role: 'host' })
  }
}
