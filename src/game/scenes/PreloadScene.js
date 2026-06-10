import Phaser from 'phaser'

const BUILD = '2026-05-27-D'

// Send log to browser console AND to npm terminal via /_log relay.
// Релей к localhost ТОЛЬКО локально — иначе на проде браузер просит «доступ к
// локальной сети» и сыплет фейл-запросами.
const _isLocalHost =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
function tlog(...args) {
  console.log(...args)
  if (!_isLocalHost) return
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
    const TILED_LEVELS = [1, 2]
    // Карты, у которых есть запечённая normal-map (level{i}_n.png) для Light2D.
    // Без неё грузим baked как одиночный diffuse — иначе отсутствующий _n.png
    // роняет загрузку всей текстуры и фон не рисуется.
    const LEVELS_WITH_NORMAL = new Set([1])
    for (const i of TILED_LEVELS) {
      this.load.tilemapTiledJSON(`level${i}`, `/levels/level${i}/level${i}.json`)
      const baked = `/levels/level${i}/level${i}.png`
      this.load.image(`level${i}-baked`, LEVELS_WITH_NORMAL.has(i)
        ? [baked, `/levels/level${i}/level${i}_n.png`]
        : baked)
    }

    // Door overlay PNGs (full-map size, placed at 0,0 like baked bg):
    //   closed1/open1 = behind player | closed2/open2 = in front of player (pass-through effect)
    this.load.image('level1-door-closed1', '/levels/level1/level1doorclosed1.png')
    this.load.image('level1-door-closed2', '/levels/level1/level1doorclosed2.png')
    this.load.image('level1-door-open1',   '/levels/level1/level1dooropen1.png')
    this.load.image('level1-door-open2',   '/levels/level1/level1dooropen2.png')

    // Кнопка-рычаг: btn1 = отжата (по умолчанию), btn2 = нажата (когда на ней игрок)
    this.load.image('btn1', '/assets/stuff/btn1.png')
    this.load.image('btn2', '/assets/stuff/btn2.png')
    // Кнопки финала: host (group 2) и player/гость (group 3), 1=отжата 2=нажата
    this.load.image('btnhost1',   '/assets/stuff/btnhost1.png')
    this.load.image('btnhost2',   '/assets/stuff/btnhost2.png')
    this.load.image('btnplayer1', '/assets/stuff/btnplayer1.png')
    this.load.image('btnplayer2', '/assets/stuff/btnplayer2.png')

    // Tilesets из level1/tileset/
    const TS = p => `/levels/level1/tileset/${p}`
    this.load.image('tilemap_packed',            TS('tilemap_packed.png'))
    this.load.image('tilemap-backgrounds_packed',TS('tilemap-backgrounds_packed.png'))
    for (let i = 1; i <= 9; i++) {
      this.load.image(`ts-${i}`, TS(`${i}.png`))
    }
    this.load.image('ts-platformer',        TS('platformer.png'))
    this.load.image('ts-all',               TS('all.png'))
    this.load.image('ts-iso',               TS('iso.png'))
    this.load.image('ts-topdown',           TS('topdown.png'))
    this.load.image('ts-topdown_jungle',    TS('topdown_jungle.png'))
    this.load.image('ts-violet-industrial', TS('violet-industrial-textures.png'))
    this.load.image('ts-castle',            TS('castle-tileset.png'))
    this.load.image('ts-snowstone',         TS('snowstone.png'))
    this.load.image('ts-dungeon-prison',    TS('dungeon-prison-theme-tilesheet.png'))
    this.load.image('ts-lined-brick',       TS('Lined Brick.png'))
    this.load.image('ts-tileset-update',    [TS('tileset_update.png'), TS('tileset_update_n.png')])
    this.load.image('ts-tileset-update-darker', TS('tileset_update  darker.png')) // 2 пробела в имени — как в JSON
    this.load.image('ts-sci-fi',            TS('sci-fi-tileset.png'))
    this.load.image('ts-spike',             TS('spike.png'))
    this.load.image('ts-platforma1',        TS('Платформа1.png'))
    this.load.image('ts-platforma2',        TS('Платформа2.png'))
    this.load.image('ts-platforma3',        TS('Платформа3.png'))
    this.load.image('ts-fonar',             TS('Фонарь.png'))
    this.load.image('ts-dver1',             TS('дверь1.png'))
    this.load.image('ts-dver2',             TS('дверь2.png'))
    this.load.image('bg-tile', '/assets/bg-tile.png')
    // Интерактивные объекты
    this.load.image('stuff-orb', '/assets/stuff/orb.png')

    // Звук лампы (положи файлы в public/assets/audio/). loaderror тихий — пока файлов
    // нет, просто не создастся звук (GameScene проверяет cache.audio.exists).
    // lamp-hum — зацикленное гудение; lamp-click — щелчок на каждый миг.
    this.load.audio('lamp-hum',   '/assets/audio/lamp-hum.mp3')
    this.load.audio('lamp-click', '/assets/audio/lamp-click.mp3')
    this.load.audio('lamp-boom',  '/assets/audio/lamp-boom.mp3')
    this.load.audio('rain-amb',   '/assets/audio/rain-01.mp3')

    // Шаги: 10 файлов footstep00..09, проигрываются по кругу при ходьбе.
    for (let i = 0; i < 10; i++) {
      const n = String(i).padStart(2, '0')
      this.load.audio(`footstep${n}`, `/assets/audio/footstep${n}.ogg`)
    }

    // Удар (анимация атаки при активации) + дверь открыть/закрыть.
    this.load.audio('knife-slice', '/assets/audio/knifeSlice.ogg')
    this.load.audio('door-open',   '/assets/audio/doorOpen_1.ogg')
    this.load.audio('door-close',  '/assets/audio/doorClose_1.ogg')

    // Кнопка-рычаг: switch_007 — наступили, switch_006 — сошли.
    this.load.audio('switch-on',  '/assets/audio/switch_007.ogg')
    this.load.audio('switch-off', '/assets/audio/switch_006.ogg')

    // Движение игрока + обрыв провода.
    this.load.audio('dash',     '/assets/audio/dash.wav')
    this.load.audio('jump',     '/assets/audio/Jump.wav')
    this.load.audio('jumpland', '/assets/audio/jumpland.wav')
    this.load.audio('rope',     '/assets/audio/rope.wav')
    this.load.audio('hit',      '/assets/audio/Hit.wav') // удар/смерть (шипы)

    // Получение способности (оверлей «Открыто»): collect1 — на текст, collect2 — на подсказку.
    this.load.audio('collect1', '/assets/audio/collect1.wav')
    this.load.audio('collect2', '/assets/audio/collect2.wav')
    this.load.audio('scroll',   '/assets/audio/Scroll.mp3') // прокрутка букв (флип-табло)

    // ── Player spritesheets 512×512, кадр 64×64 (8 cols × 8 rows) ────────────
    this.load.spritesheet('blue-knight',   '/assets/playerblue/blueknight.png',    { frameWidth: 64, frameHeight: 64 })
    this.load.spritesheet('orange-knight', '/assets/playerorange/orangeknight.png', { frameWidth: 64, frameHeight: 64 })

    // Parallax backdrop layers — real pixel-art PNGs go in /public/assets/parallax/
    // loaderror fires silently, so listing here is safe even if files don't exist yet.
    // When the file IS present, it overrides the generated placeholder below.
    this.load.image('px-sky',         '/assets/parallax/px-sky.png')
    // [diffuse, normal] → Phaser привяжет normal map к текстуре (texture.dataSource).
    // Light2D освещает поверхность с учётом рельефа нормалей.
    this.load.image('px-mtn',         ['/assets/parallax/px-mtn.png',         '/assets/parallax/px-mtn_n.png'])
    this.load.image('px-clouds-far',  ['/assets/parallax/px-clouds-far.png',  '/assets/parallax/px-clouds-far_n.png'])
    this.load.image('px-clouds-near', ['/assets/parallax/px-clouds-near.png', '/assets/parallax/px-clouds-near_n.png'])
    this.load.image('px-clouds-btm',  ['/assets/parallax/px-clouds_btm.png',  '/assets/parallax/px-clouds_btm_n.png'])

    // Level 1 parallax — 13 слоёв из /assets/parallax/level1/ (каждый 576×324)
    // 1 фон, 2 гора, 3-7 здания, 8-13 облака. Файлы названы просто "1.png".."13.png".
    const L1 = name => `/assets/parallax/level1/${name}.png`
    for (let i = 1; i <= 13; i++) {
      this.load.image(`px-${i}`, L1(`${i}`))
    }
    // Передние декорации (силуэты поверх всего кроме дождя), fore1..fore10.
    // key fore1r → файл "fore1 r.png" (зеркальная версия).
    // loaderror тихий → перечислять несуществующие безопасно (добавишь PNG — заработает).
    // FORE_NORMALS: у каких ключей есть карта нормалей "<имя>_n.png" → грузим [diffuse, normal],
    // тогда GameScene включит им Light2D/SoftLight (на них падает цветной свет от ламп с рельефом).
    // Добавил нормаль другому fore — впиши сюда key→имя_файла_нормали (без .png).
    const FORE_NORMALS = { fore1r: 'fore1 r_n', fore4: 'fore4_n' }
    const loadFore = (key, diffuse) => {
      const n = FORE_NORMALS[key]
      this.load.image(key, n ? [L1(diffuse), L1(n)] : L1(diffuse))
    }
    for (let i = 1; i <= 10; i++) {
      loadFore(`fore${i}`, `fore${i}`)
      loadFore(`fore${i}r`, `fore${i} r`)
    }
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
    const PX_KEYS = ['px-sky', 'px-mtn', 'px-clouds-far', 'px-clouds-near', 'px-clouds-btm']
    for (const k of PX_KEYS) {
      tlog(`[Preload] parallax "${k}": ${this.textures.exists(k) ? '✓ загружен' : '✗ не найден'}`)
    }

    g.destroy()

    // ── Player animations (spritesheet 64×64, 8 cols × 8 rows) ─────────────
    // row1=idle 0-4 | row2=run 8-15 | row3=jump 16-18 | row4=fall 24-25
    // row5=attack 32-37 | row6=hit 40 | row7=dead 48-54 | row8=shield 56-57
    const gfn = (key, frames) => this.anims.generateFrameNumbers(key, { frames })

    this.anims.create({ key: 'blue-idle',     frames: gfn('blue-knight',   [0,1,2,3,4]),                frameRate: 8,  repeat: -1 })
    this.anims.create({ key: 'blue-run',      frames: gfn('blue-knight',   [8,9,10,11,12,13,14,15]),    frameRate: 12, repeat: -1 })
    this.anims.create({ key: 'blue-attack',   frames: gfn('blue-knight',   [32,33,34,35,36,37]),        frameRate: 12, repeat:  0 })
    this.anims.create({ key: 'orange-idle',   frames: gfn('orange-knight', [0,1,2,3,4]),                frameRate: 8,  repeat: -1 })
    this.anims.create({ key: 'orange-run',    frames: gfn('orange-knight', [8,9,10,11,12,13,14,15]),   frameRate: 12, repeat: -1 })
    this.anims.create({ key: 'orange-attack', frames: gfn('orange-knight', [32,33,34,35,36,37]),       frameRate: 12, repeat:  0 })
    // row6=hit(40)  row7=dead(48-54)  row8=shield(56-57)
    this.anims.create({ key: 'blue-hit',      frames: gfn('blue-knight',   [40]),                      frameRate: 10, repeat:  0 })
    this.anims.create({ key: 'blue-dead',     frames: gfn('blue-knight',   [48,49,50,51,52,53,54]),    frameRate: 8,  repeat:  0 })
    this.anims.create({ key: 'blue-shield',   frames: gfn('blue-knight',   [56,57]),                   frameRate: 6,  repeat: -1 })
    this.anims.create({ key: 'orange-hit',    frames: gfn('orange-knight', [40]),                      frameRate: 10, repeat:  0 })
    this.anims.create({ key: 'orange-dead',   frames: gfn('orange-knight', [48,49,50,51,52,53,54]),    frameRate: 8,  repeat:  0 })
    this.anims.create({ key: 'orange-shield', frames: gfn('orange-knight', [56,57]),                   frameRate: 6,  repeat: -1 })

    tlog('[Preload] → starting GameScene')
    this.scene.start('GameScene', window.__l2s || { levelId: 1, role: 'host' })
  }
}
