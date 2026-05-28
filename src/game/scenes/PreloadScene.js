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
    // Numeric tileset sheets 1.png … 9.png — keys 'ts-1' … 'ts-9'
    // loaderror fires silently if a file is absent, so listing extras here is safe
    for (let i = 1; i <= 9; i++) {
      this.load.image(`ts-${i}`, `/levels/${i}.png`)
    }
    // Named tileset sheets
    this.load.image('ts-platformer',     '/levels/platformer.png')
    this.load.image('ts-all',            '/levels/all.png')
    this.load.image('ts-iso',            '/levels/iso.png')
    this.load.image('ts-topdown',        '/levels/topdown.png')
    this.load.image('ts-topdown_jungle', '/levels/topdown_jungle.png')
    this.load.image('bg-tile', '/assets/bg-tile.png')

    // Parallax backdrop layers — real pixel-art PNGs go in /public/assets/parallax/
    // loaderror fires silently, so listing here is safe even if files don't exist yet.
    // When the file IS present, it overrides the generated placeholder below.
    this.load.image('px-sky',         '/assets/parallax/px-sky.png')
    this.load.image('px-mtn',         '/assets/parallax/px-mtn.png')
    this.load.image('px-clouds-far',  '/assets/parallax/px-clouds-far.png')
    this.load.image('px-clouds-near', '/assets/parallax/px-clouds-near.png')
    this.load.image('px-clouds-btm',  '/assets/parallax/px-clouds_btm.png')
  }

  create() {
    const hasPng    = this.textures.exists('tilemap_packed')
    const hasLevel1 = this.cache.tilemap.exists('level1')

    tlog(`[Preload] create() — tilemap_packed=${hasPng}  level1=${hasLevel1}`)

    if (!hasPng)    tlog('[Preload] ❌ tilemap_packed.png НЕ загружен! Проверь public/levels/tilemap_packed.png')
    if (!hasLevel1) tlog('[Preload] ❌ level1.json НЕ загружен! Проверь public/levels/level1.json')

    // Players — 10×16 world-pixel sprites (same proportions as Celeste on 320×180 canvas)
    // Hitbox (set in Player.js): 8×11, bottom-aligned at offset (1,5)
    // Layout: 2px head (top 5px), 4px torso (next 7px), 4px legs (bottom 4px)
    const g = this.make.graphics({ x: 0, y: 0, add: false })

    // Blue (host)
    g.fillStyle(0x4488ff); g.fillRect(1, 0,  8, 5)   // head
    g.fillStyle(0x2266cc); g.fillRect(0, 5, 10, 7)   // torso
    g.fillStyle(0x1a4499); g.fillRect(1, 12, 4, 4)   // leg L
    g.fillStyle(0x1a4499); g.fillRect(5, 12, 4, 4)   // leg R
    g.fillStyle(0x88bbff); g.fillRect(2, 1,  3, 3)   // eye
    g.generateTexture('player-blue', 10, 16); g.clear()

    // Orange (guest)
    g.fillStyle(0xff8844); g.fillRect(1, 0,  8, 5)
    g.fillStyle(0xcc5522); g.fillRect(0, 5, 10, 7)
    g.fillStyle(0x993311); g.fillRect(1, 12, 4, 4)
    g.fillStyle(0x993311); g.fillRect(5, 12, 4, 4)
    g.fillStyle(0xffcc88); g.fillRect(2, 1,  3, 3)
    g.generateTexture('player-orange', 10, 16); g.clear()

    // Transparent 1×1 physics placeholders for ground/platforms
    // → NO visible color; tile layers from tilemap_packed.png provide all visuals
    g.generateTexture('tile-ground',   1, 1); g.clear()
    g.generateTexture('tile-platform', 1, 1); g.clear()

    // Game-object physics placeholders — transparent 1×1, NO visual.
    g.generateTexture('orb',   1, 1); g.clear()
    g.generateTexture('plate', 1, 1); g.clear()
    g.generateTexture('door',  1, 1); g.clear()
    g.generateTexture('sign',  1, 1); g.clear()

    // Parallax PNGs загружаются из /public/assets/parallax/ (см. preload выше).
    // NEAREST фильтр (дефолт pixelArt:true) — оставляем, снэппинг к canvas-пикселю в _updateParallax.
    const PX_KEYS = ['px-sky', 'px-mtn', 'px-clouds-far', 'px-clouds-near', 'px-clouds-btm']
    for (const k of PX_KEYS) {
      tlog(`[Preload] parallax "${k}": ${this.textures.exists(k) ? '✓ загружен' : '✗ не найден'}`)
    }

    g.destroy()

    tlog('[Preload] → starting GameScene')
    this.scene.start('GameScene', window.__l2s || { levelId: 1, role: 'host' })
  }
}
