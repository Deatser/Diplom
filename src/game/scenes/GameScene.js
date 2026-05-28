import Phaser from 'phaser'
import { Player } from '../entities/Player.js'
import { networkClient } from '../../network/NetworkClient.js'
import { SaveSystem } from '../../systems/SaveSystem.js'
import {
	exitToLevelSelect,
	saveSessionPlaytime,
	togglePause,
} from '../GameManager.js'

// Log to browser console + npm terminal simultaneously
function tlog(...args) {
	console.log(...args)
	const msg = args
		.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
		.join(' ')
	fetch('http://localhost:3000/_log', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ args: [msg] }),
	}).catch(() => {})
}

const CAM_W = 1280,
	CAM_H = 720
const WORLD_W = 1280
const WORLD_H = 4000

function toPhKey(code) {
	if (!code) return 'A'
	const map = {
		Space: 'SPACE',
		ShiftLeft: 'SHIFT',
		ShiftRight: 'SHIFT',
		ControlLeft: 'CTRL',
		ControlRight: 'CTRL',
		ArrowLeft: 'LEFT',
		ArrowRight: 'RIGHT',
		ArrowUp: 'UP',
		ArrowDown: 'DOWN',
	}
	if (map[code]) return map[code]
	if (code.startsWith('Key')) return code.slice(3)
	return code
}

export class GameScene extends Phaser.Scene {
	constructor() {
		super('GameScene')
	}

	init(data) {
		const src = data && data.levelId ? data : window.__l2s || {}
		this.levelId = src.levelId || 1
		this.role = src.role || 'host'
		this._netUnsub = []
		this._syncTimer = 0
		this._orbCollected = false
		this._exiting = false
		this._gamePaused = false
		this._exitZone = null
		this._orbOverlap1 = null
		this._orbOverlap2 = null
		this._parallaxLayers = [] // [{sprite, sfX, sfY, driftX, driftY, _driftAccX, _driftAccY}]
		this._driftSprites = [] // [{spr, velX, _acc}] — декоративные спрайты с pixel-точным движением
		console.log('[GameScene] init levelId=', this.levelId, 'role=', this.role)
	}

	create() {
		tlog(`[GameScene] ══ BUILD 2026-05-27-D  levelId=${this.levelId} ══`)
		tlog(
			`[GameScene] tilemap_packed loaded : ${this.textures.exists('tilemap_packed')}`,
		)
		tlog(
			`[GameScene] level${this.levelId} in cache: ${this.cache.tilemap.exists('level' + this.levelId)}`,
		)

		// World + camera bounds are set inside _buildFromTiledMap() from map.widthInPixels/heightInPixels
		// Fallback values used for _buildLevel10() / _buildStub() which don't call Tiled:
		this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H)
		this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H)

		this._buildLevel()
		this._createParallaxBg()

		const localTex = this.role === 'host' ? 'player-blue' : 'player-orange'
		const remoteTex = this.role === 'host' ? 'player-orange' : 'player-blue'

		const spawn = this._getSpawn()
		this.localPlayer = new Player(this, spawn.x, spawn.y, localTex, true)
		this.remotePlayer = new Player(
			this,
			spawn.x + 50,
			spawn.y,
			remoteTex,
			false,
		)

		this.remotePlayer.body.setAllowGravity(false)
		this.remotePlayer.body.setImmovable(true)

		this.physics.add.collider(this.localPlayer, this.platforms)
		this.physics.add.collider(this.localPlayer, this.dynamicPlatforms)

		if (this._exitZone) {
			this.physics.add.overlap(this.localPlayer, this._exitZone, () =>
				this._exitLevel(),
			)
		}

		this._grantPreviousAbilities()

		// ── Camera: 1 world unit = 1 big pixel, zoom=1.0 always ──
		// Canvas 320×180 — Scale.FIT multiplies: ×4 on 720p, ×6 on 1080p, ×8 on 2K
		// this.game.scale = Phaser ScaleManager (≠ this.scale which is sprite Size component)
		// setMaxSize caps the display size to the resolution from video settings
		this._camTarget = { x: spawn.x, y: spawn.y }
		this.cameras.main.setZoom(1.0)
		// lerpX/Y = 1.0: камера мгновенно на _camTarget (вся плавность — в _updateCamera)
		this.cameras.main.startFollow(this._camTarget, true, 1.0, 1.0)
		try {
			const res = SaveSystem.getSettings().video?.resolution || '1920x1080'
			const [resW, resH] = res.split('x').map(Number)
			this.game.scale.setMaxSize(resW || 1920, resH || 1080)
		} catch (_) {
			/* ScaleManager API varies by Phaser version — non-critical */
		}

		// Input keys
		const bindings = SaveSystem.getSettings().keybindings
		const keyLeft = toPhKey(bindings.move_left) || 'A'
		const keyRight = toPhKey(bindings.move_right) || 'D'
		const keyJump = toPhKey(bindings.jump) || 'SPACE'
		const keyDash = toPhKey(bindings.dash) || 'SHIFT'
		const keyDown = toPhKey(bindings.down) || 'S'
		console.log('[GameScene] Keys:', {
			keyLeft,
			keyRight,
			keyJump,
			keyDash,
			keyDown,
		})
		this.keys = {
			left: this.input.keyboard.addKey(keyLeft),
			right: this.input.keyboard.addKey(keyRight),
			jump: this.input.keyboard.addKey(keyJump),
			jumpW: this.input.keyboard.addKey('W'),
			dash: this.input.keyboard.addKey(keyDash),
			down: this.input.keyboard.addKey(keyDown),
		}

		// Dash trail particles
		this._dashParticles = this.add.particles(0, 0, localTex, {
			speed: { min: 20, max: 80 },
			scale: { start: 0.4, end: 0 },
			alpha: { start: 0.6, end: 0 },
			lifespan: 200,
			quantity: 3,
			emitting: false,
		})

		// ── Network ──
		this._netUnsub.push(
			networkClient.on('playerInput', ({ input }) => {
				this.remotePlayer.setNetworkState(input)
			}),
		)
		this._netUnsub.push(networkClient.on('swapExecute', () => this._doSwap()))

		this._netUnsub.push(
			networkClient.on('game:exit', () => {
				console.log('[GameScene] Partner exited — forcing exit')
				// Force exit regardless of _exiting state (e.g. partner left from level-complete screen)
				this._netUnsub.forEach(u => u())
				this._netUnsub = []
				saveSessionPlaytime()
				this.scene.stop()
				exitToLevelSelect()
			}),
		)

		this._netUnsub.push(
			networkClient.on('levelComplete', () => {
				console.log('[GameScene] Partner reached exit')
				if (!this._exiting) {
					this._exiting = true
					// Guest never touches exit zone directly — update maxLevel here so
					// LevelSelectScreen shows correct unlocked levels when returning
					const newLevel = Math.min(this.levelId + 1, 10)
					window.__currentSlotMaxLevel = newLevel
					this._showLevelComplete()
				}
			}),
		)

		// ── Level transition: host sends game:start, only guest receives it ──
		// We restart unconditionally — server sends via socket.to() (excludes sender)
		this._netUnsub.push(
			networkClient.on('game:start', ({ levelId }) => {
				console.log(
					'[GameScene] game:start received → level',
					levelId,
					'(guest side)',
				)
				this._netUnsub.forEach(u => u())
				this._netUnsub = []
				window.__l2s = { ...window.__l2s, levelId }
				// Small delay to avoid Phaser scene restart race condition
				this.time.delayedCall(50, () => {
					this.scene.restart({ levelId, role: this.role })
				})
			}),
		)

		this._updateHUD()

		// Menu key (tilde/ё by default, rebindable) → toggle pause
		const menuCode = SaveSystem.getSettings().keybindings.menu || 'Backquote'
		this.input.keyboard.on('keydown', event => {
			if (event.code === menuCode && !this._exiting) togglePause(this)
		})

		if (this.orb) {
			this._orbOverlap1 = this.physics.add.overlap(
				this.localPlayer,
				this.orb,
				() => this._collectOrb(),
			)
			this._orbOverlap2 = this.physics.add.overlap(
				this.remotePlayer,
				this.orb,
				() => this._collectOrb(),
			)
		}

		if (this.pressurePlate && this.door) {
			this._plateActive = false
		}
	}

	update(time, delta) {
		// Always interpolate remote player so they stay smooth for both sides
		this.remotePlayer.updateRemote(delta)

		// Skip everything else when paused (input, physics, network sync)
		if (this._gamePaused) return

		this.localPlayer.updateLocal(this.keys, delta, time)
		this._updateCamera(delta)
		this._updateParallax(delta)
		this._updateDriftSprites(delta)

		// Pressure plate logic
		if (this.pressurePlate && this.door) {
			const onPlate =
				this.physics.overlap(this.localPlayer, this.pressurePlate) ||
				this.physics.overlap(this.remotePlayer, this.pressurePlate)

			if (onPlate !== this._plateActive) {
				this._plateActive = onPlate
				this.door.setVisible(!onPlate)
				if (this.doorBody) this.doorBody.body.enable = !onPlate
			}
		}

		// Send state every 16ms (~60fps) — tight sync for local LAN smoothness
		this._syncTimer += delta
		if (this._syncTimer >= 16) {
			this._syncTimer = 0
			networkClient.sendInput(this.localPlayer.getNetworkState())
		}

		// RMB special
		if (this.input.mousePointer.rightButtonDown() && !this._rmbPrev) {
			this._handleSpecial()
		}
		this._rmbPrev = this.input.mousePointer.rightButtonDown()
	}

	spawnDashParticles(x, y, facingRight) {
		this._dashParticles.setPosition(x, y)
		this._dashParticles.explode(8)
	}

	_handleSpecial() {
		const p = this.localPlayer
		if (p.hasAbility('conjurePlatform')) {
			const px = p.x,
				py = p.y + 40
			const tp = this.dynamicPlatforms
				.create(px, py, 'tile-platform')
				.setScale(4, 1)
				.refreshBody()
			this.time.delayedCall(4000, () => {
				tp.destroy()
			})
		}
		if (p.hasAbility('swap')) {
			networkClient.requestSwap()
		}
	}

	_doSwap() {
		const lx = this.localPlayer.x,
			ly = this.localPlayer.y
		const rx = this.remotePlayer.x,
			ry = this.remotePlayer.y
		this.localPlayer.setPosition(rx, ry)
		this.remotePlayer.setPosition(lx, ly)
		this.localPlayer.body.reset(rx, ry)
	}

	_collectOrb() {
		if (this._orbCollected) return
		this._orbCollected = true
		if (this._orbOverlap1) {
			this.physics.world.removeCollider(this._orbOverlap1)
			this._orbOverlap1 = null
		}
		if (this._orbOverlap2) {
			this.physics.world.removeCollider(this._orbOverlap2)
			this._orbOverlap2 = null
		}
		this.orb.destroy()
		const abilityName = this._getLevelAbility()
		if (!abilityName) return
		console.log('[GameScene] ORB collected! Ability:', abilityName)
		this.localPlayer.unlock(abilityName)
		this.remotePlayer.unlock(abilityName)
		this._showAbilityUnlock(abilityName)
		this._updateHUD()
	}

	_showAbilityUnlock(name) {
		const labels = {
			dash: 'Дэш',
			doubleJump: 'Двойной прыжок',
			wallCling: 'Цепляние за стены',
			groundSlam: 'Удар о землю',
			airDive: 'Воздушный рывок вниз',
			grapple: 'Крюк-кошка',
			glide: 'Парение',
			conjurePlatform: 'Призыв платформы',
			swap: 'Обмен позициями',
			chargedDash: 'Заряженный дэш',
		}
		// Canvas is 320×180 — use setScrollFactor(0) so overlay sticks to screen coords
		const cx = 160,
			cy = 90
		const overlay = this.add
			.rectangle(cx, cy, 320, 180, 0x000000, 0.8)
			.setScrollFactor(0)
			.setDepth(50)
		const title = this.add
			.text(cx, cy - 18, 'Способность получена', {
				fontSize: '9px',
				color: '#c8a96e',
				fontFamily: 'Cinzel, serif',
			})
			.setOrigin(0.5)
			.setScrollFactor(0)
			.setDepth(51)
		const ability = this.add
			.text(cx, cy + 4, labels[name] || name, {
				fontSize: '16px',
				color: '#ffffff',
				fontFamily: 'Cinzel Decorative, serif',
				shadow: {
					offsetX: 0,
					offsetY: 0,
					color: '#ffffff',
					blur: 8,
					fill: true,
				},
			})
			.setOrigin(0.5)
			.setScrollFactor(0)
			.setDepth(51)
		this.time.delayedCall(2500, () => {
			overlay.destroy()
			title.destroy()
			ability.destroy()
		})
	}

	_updateHUD() {
		const el = document.getElementById('hud-abilities')
		if (!el) return
		const all = [
			'dash',
			'doubleJump',
			'wallCling',
			'groundSlam',
			'airDive',
			'grapple',
			'glide',
			'conjurePlatform',
			'swap',
			'chargedDash',
		]
		const labels = {
			dash: 'Дэш',
			doubleJump: '2×Прыжок',
			wallCling: 'Стена',
			groundSlam: 'Слэм',
			airDive: 'Рывок↓',
			grapple: 'Крюк',
			glide: 'Парение',
			conjurePlatform: 'Платформа',
			swap: 'Обмен',
			chargedDash: 'Заряд',
		}
		el.innerHTML = all
			.map(
				a => `
      <div class="hud-ability ${this.localPlayer?.hasAbility(a) ? 'unlocked' : ''}">${labels[a]}</div>
    `,
			)
			.join('')
	}

	// Only dash + doubleJump for now (other mechanics removed until later)
	_grantPreviousAbilities() {
		const grant = a => {
			this.localPlayer.unlock(a)
			this.remotePlayer.unlock(a)
		}
		if (this.levelId >= 2) grant('dash')
		if (this.levelId >= 3) grant('doubleJump')
		// Level 10 gets both
		if (this.levelId >= 10) {
			grant('dash')
			grant('doubleJump')
		}
	}

	// Level 1 → dash, Level 2 → doubleJump, 3+ → nothing for now
	_getLevelAbility() {
		const map = { 1: 'dash', 2: 'doubleJump' }
		return map[this.levelId] || null
	}

	// ── Parallax backdrop system ─────────────────────────────────────────────────
	//
	// ДВА типа слоёв:
	//
	// 1. TILE-слои (tileSprite) — бесконечно тайлятся по всему экрану.
	//    Используй для: небо, туман, звёзды, бесшовные паттерны.
	//    "Позиции" нет — изображение везде. Контролируешь только скорость (sfX/sfY).
	//    offsetX/Y = с какой части картинки начать (пиксели в PNG).
	//
	// 2. SPRITE-слои (image) — обычный спрайт в конкретном месте мира.
	//    Используй для: конкретное облако, гора, здание на определённой высоте.
	//    wx/wy = координаты В МИРЕ (те же что в Tiled). sfX/sfY = параллакс.
	//    Спрайт не тайлится — он ровно там где ты сказал.
	//
	// КАРТА УРОВНЕЙ: для каждого уровня свой конфиг ниже.
	// Координаты wx/wy — в пикселях мира (совпадают с Tiled: 1px = 1 тайл-пиксель).
	// Мир level1: 1280×3568 px (80×223 тайлов по 16px).
	_createParallaxBg() {
		// ════════════════════════════════════════════════════════════════════════
		// КОНФИГ СЛОЁВ — редактируй здесь
		// ════════════════════════════════════════════════════════════════════════

		//── Тип 1: tileSprite — бесконечный тайлинг по всему экрану ────────────
		// Сейчас пусто — все изображения расставляются через объекты Tiled (тип Oblako).
		// Добавь строку сюда если нужен глобальный тайлящийся фон на весь экран.
		const TILE_LAYERS = []

		// ── Тип 2: image — спрайт на конкретном месте в мире ───────────────────
		// wx/wy: координаты в МИРОВЫХ пикселях (как в Tiled).
		// w/h:   размер в мировых пикселях (0 = оригинальный размер PNG).
		// sfX/Y: параллакс (0=неподвижен, 1=движется вместе с тайлами).
		// origin: [0,0]=левый верхний угол, [0.5,0.5]=центр (как Tiled rectangle).
		const SPRITE_LAYERS = [
			// Пример: большое облако в середине уровня
			// { key: 'px-cloud-big', wx: 400, wy: 1200, w: 0, h: 0, sfX: 0.3, sfY: 0.3, origin: [0, 0], depth: -1 },
			// Пример: горный хребет на высоте 2000px от верха карты
			// { key: 'px-mountains', wx: 0, wy: 2000, w: 1280, h: 300, sfX: 0.1, sfY: 0.1, origin: [0, 0], depth: -3 },
		]

		// ════════════════════════════════════════════════════════════════════════
		// НИЖЕ — только логика, не трогай
		// ════════════════════════════════════════════════════════════════════════

		tlog('[Parallax] ── создание слоёв ──')

		// Создаём tile-слои
		for (const cfg of TILE_LAYERS) {
			const hasReal = this.textures.exists(cfg.key)
			const texKey = hasReal ? cfg.key : 'px-sky'

			let sprite
			if (hasReal) {
				const src = this.textures.get(cfg.key).source[0]
				sprite = this.add
					.tileSprite(0, 0, 320, 180, texKey)
					.setOrigin(0, 0)
					.setScrollFactor(0)
					.setDepth(cfg.depth)
				sprite.tilePositionX = cfg.offsetX
				sprite.tilePositionY = cfg.offsetY
				tlog(
					`[Parallax] TILE ✓ ${cfg.key}  PNG=${src.width}×${src.height}  sf=(${cfg.sfX},${cfg.sfY})  drift=(${cfg.driftX},${cfg.driftY})  offset=(${cfg.offsetX},${cfg.offsetY})`,
				)
			} else {
				const colors = {
					'px-sky': 0x060d1a,
					'px-mtn': 0x0d1833,
					'px-clouds-far': 0x132040,
					'px-clouds-near': 0x182848,
				}
				sprite = this.add
					.tileSprite(0, 0, 320, 180, texKey)
					.setOrigin(0, 0)
					.setScrollFactor(0)
					.setDepth(cfg.depth)
					.setTint(colors[cfg.key] ?? 0x0a0f2e)
				tlog(
					`[Parallax] TILE ⚙ ${cfg.key}  заглушка  sf=(${cfg.sfX},${cfg.sfY})  drift=(${cfg.driftX},${cfg.driftY})`,
				)
			}

			this._parallaxLayers.push({
				sprite,
				sfX: cfg.sfX,
				sfY: cfg.sfY,
				driftX: cfg.driftX,
				driftY: cfg.driftY,
				_driftAccX: cfg.offsetX,
				_driftAccY: cfg.offsetY,
			})
		}

		// Создаём sprite-слои (конкретные позиции в мире)
		for (const cfg of SPRITE_LAYERS) {
			if (!this.textures.exists(cfg.key)) {
				tlog(
					`[Parallax] SPRITE ✗ ${cfg.key} — текстура не загружена, пропускаем`,
				)
				continue
			}
			const spr = this.add
				.image(cfg.wx, cfg.wy, cfg.key)
				.setOrigin(cfg.origin[0], cfg.origin[1])
				.setScrollFactor(cfg.sfX, cfg.sfY)
				.setDepth(cfg.depth)
			if (cfg.w && cfg.h) spr.setDisplaySize(cfg.w, cfg.h)
			const src = this.textures.get(cfg.key).source[0]
			tlog(
				`[Parallax] SPRITE ✓ ${cfg.key}  wx=${cfg.wx} wy=${cfg.wy}  sf=(${cfg.sfX},${cfg.sfY})  size=${cfg.w || src.width}×${cfg.h || src.height}`,
			)
		}

		tlog(
			`[Parallax] готово: ${TILE_LAYERS.length} tile + ${SPRITE_LAYERS.filter(s => this.textures.exists(s.key)).length} sprite слоёв`,
		)
	}

	// Вызывается каждый кадр — сдвигает tilePosition tile-слоёв
	_updateParallax(delta) {
		if (!this._parallaxLayers.length) return
		const cam = this.cameras.main
		const dtS = Math.min(delta / 1000, 0.05)

		for (const L of this._parallaxLayers) {
			L._driftAccX += L.driftX * dtS
			L._driftAccY += L.driftY * dtS
			const tsx = L.sprite.tileScaleX || 1
			const tsy = L.sprite.tileScaleY || 1
			// Позиция накапливается как float (canvas px), но tilePositionX округляется
			// до целого canvas-пикселя перед конвертацией в texture-координаты.
			// 1 canvas px = 6–8 экранных px → арт-пиксель не разрывается пополам.
			const screenX = cam.scrollX * L.sfX + L._driftAccX
			const screenY = cam.scrollY * L.sfY + L._driftAccY
			L.sprite.tilePositionX = Math.round(screenX) / tsx
			L.sprite.tilePositionY = Math.round(screenY) / tsy
		}
	}

	// Вызывается каждый кадр — двигает Oblako спрайты.
	// roundPixels убран из конфига → дробные px разрешены → анимация плавная на любой скорости.
	_updateDriftSprites(delta) {
		if (!this._driftSprites.length) return
		const dtS = Math.min(delta / 1000, 0.05)
		for (const item of this._driftSprites) {
			item.spr.x += item.velX * dtS
		}
	}

	// ── Celeste-точная камера ────────────────────────────────────────────────────
	// Источник: NoelFB/Celeste Player.cs — CameraTarget + camera update loop
	//
	// target = (player.x, player.y)  — просто центр на игроке, без lookahead при ходьбе
	//   (lookahead есть только в спец. состояниях: feather, red dash — сейчас не нужно)
	//
	// Плавность — экспоненциальный распад (frame-rate independent!):
	//   pos = pos + (target - pos) * (1 - 0.01 ^ deltaTime)
	//   ≈ 7.4% приближение к цели за кадр при 60fps → ≈ 30 кадров до прихода
	//   Это именно та формула из исходников Celeste.
	_updateCamera(delta) {
		const p = this.localPlayer
		const dtS = Math.min(delta / 1000, 0.05) // секунды, cap 50ms на случай лагов

		// Точная формула из Celeste:
		const factor = 1 - Math.pow(0.01, dtS)

		this._camTarget.x += (p.x - this._camTarget.x) * factor
		this._camTarget.y += (p.y - this._camTarget.y) * factor
	}

	_getSpawn() {
		return this._spawnFromMap || { x: 80, y: WORLD_H - 90 }
	}

	_buildLevel() {
		this.platforms = this.physics.add.staticGroup()
		this.dynamicPlatforms = this.physics.add.staticGroup()
		this._spawnFromMap = null
		this._useTiledVisuals = false // set true when real tile layers are rendered

		const mapKey = `level${this.levelId}`
		if (this.cache.tilemap.exists(mapKey)) {
			this._buildFromTiledMap(mapKey)
		} else if (this.levelId === 10) {
			this._buildLevel10()
		} else {
			this._buildStub()
		}
	}

	// ── Tiled map builder ───────────────────────────────────────────────────────
	// Renders tile layers 'back' (depth 1) and 'plat' (depth 4) for visuals.
	// Parses 'objects' layer for collision/game-logic objects.
	// Object types: ground | platform | spawn | exit | orb | plate | door | sign
	_buildFromTiledMap(mapKey) {
		const map = this.make.tilemap({ key: mapKey })

		// All ground/platform visuals come from Tiled tile layers — NEVER draw tileSprites.
		// Even if the PNG failed to load, no fallback stubs are drawn.
		this._useTiledVisuals = true

		// ── World bounds from map size (auto, no hardcode needed) ─────────────────
		const mapW = map.widthInPixels // tileWidth  × mapTileWidth
		const mapH = map.heightInPixels // tileHeight × mapTileHeight
		tlog(
			`[Level] Map size: ${mapW}×${mapH} px (${map.width}×${map.height} tiles @ ${map.tileWidth}px)`,
		)
		this.physics.world.setBounds(0, 0, mapW, mapH)
		this.cameras.main.setBounds(0, 0, mapW, mapH)

		// ── Diagnostics ───────────────────────────────────────────────────────
		const layerNames = map.layers.map(l => l.name)
		tlog(`[Level] ══ Tiled map: ${mapKey} ══`)
		tlog(`[Level] Tile layers: [${layerNames.join(', ')}]`)
		tlog(
			`[Level] Tilesets in JSON: [${(map.tilesets || []).map(t => t.name).join(', ')}]`,
		)

		// ── Tileset registry ─────────────────────────────────────────────────────
		// Maps Tiled tileset name → Phaser texture key + explicit tile size for
		// external TSX tilesets (Phaser cannot parse TSX files automatically).
		// Add rows here whenever you add a new tileset sheet to public/levels/.
		const TILESET_MAP = {
			tilemap_packed: { key: 'tilemap_packed' },
			'tilemap-backgrounds_packed': {
				key: 'tilemap-backgrounds_packed',
				w: 24,
				h: 24,
			},
			// Numeric sheets 1.png … 9.png
			1: { key: 'ts-1', w: 16, h: 16 },
			2: { key: 'ts-2', w: 16, h: 16 },
			3: { key: 'ts-3', w: 16, h: 16 },
			4: { key: 'ts-4', w: 16, h: 16 },
			5: { key: 'ts-5', w: 16, h: 16 },
			6: { key: 'ts-6', w: 16, h: 16 },
			7: { key: 'ts-7', w: 16, h: 16 },
			8: { key: 'ts-8', w: 16, h: 16 },
			9: { key: 'ts-9', w: 16, h: 16 },
			// Named sheets
			platformer: { key: 'ts-platformer', w: 8, h: 8 },
			all: { key: 'ts-all', w: 16, h: 16 },
			iso: { key: 'ts-iso', w: 16, h: 16 },
			topdown: { key: 'ts-topdown', w: 16, h: 16 },
			topdown_jungle: { key: 'ts-topdown_jungle', w: 16, h: 16 },
		}

		const tilesets = []
		for (const ts of map.tilesets || []) {
			const info = TILESET_MAP[ts.name]
			if (!info) {
				tlog(
					`[Level] ⚠ Unknown tileset "${ts.name}" — add it to TILESET_MAP in GameScene.js`,
				)
				continue
			}
			if (!this.textures.exists(info.key)) {
				tlog(
					`[Level] ⚠ Tileset "${ts.name}" — texture "${info.key}" not loaded (check PreloadScene)`,
				)
				continue
			}
			const phTs = info.w
				? map.addTilesetImage(ts.name, info.key, info.w, info.h, 0, 0)
				: map.addTilesetImage(ts.name, info.key)
			if (phTs) {
				tilesets.push(phTs)
				tlog(`[Level] ✓ Tileset "${ts.name}" → ${info.key}`)
			} else {
				tlog(
					`[Level] ❌ addTilesetImage failed for "${ts.name}" (name mismatch in JSON?)`,
				)
			}
		}

		// ── Render all tile layers automatically ─────────────────────────────────
		// Every layer in the JSON is rendered using all registered tilesets.
		// Depth: back=1 (far bg), cloud=2 (mid bg), everything else=4 (platforms/fg)
		// Parallax scrollFactor: back=0.2 (slow sky), cloud=0.5 (mid clouds), rest=1.0
		if (tilesets.length > 0) {
			for (const layerData of map.layers) {
				const name = layerData.name
				const depth = name === 'back' ? 1 : name === 'cloud' ? 2 : 4
				try {
					// scrollFactor=1 (дефолт) — тайлы рендерятся на своих мировых позициях.
					// Параллакс для фонов делается через Oblako-объекты, не через tile-слои.
					map.createLayer(name, tilesets, 0, 0)?.setDepth(depth)
					tlog(`[Level] ✓ layer "${name}" rendered (depth ${depth})`)
				} catch (e) {
					tlog(`[Level] ⚠ layer "${name}" render error: ${e.message}`)
				}
			}
		} else {
			tlog('[Level] ⚠ No tilesets registered — tile layers invisible')
		}

		// ── Object layers — обрабатываем ВСЕ object-слои карты ──────────────────
		// Tiled позволяет создавать несколько слоёв объектов ('objects', 'BackPngs', etc.)
		// Каждый слой обрабатывается одинаково — switch по type определяет что делать.
		const allObjLayers = map.objects || []
		const hasCollisionLayer = allObjLayers.some(l => l.name === 'objects')

		if (!hasCollisionLayer) {
			tlog('[Level] ⚠ Нет слоя "objects" — fallback на stub-коллизию')
			this._buildStub()
			// Продолжаем — могут быть визуальные объекты в других слоях (BackPngs etc.)
		}

		if (allObjLayers.length === 0) return

		const allObjects = allObjLayers.flatMap(l => l.objects)
		tlog(
			`[Level] Objects: ${allObjects.length} total (слои: ${allObjLayers.map(l => l.name).join(', ')})`,
		)
		for (const obj of allObjects) {
			const { type, x, y, width = 0, height = 0, properties = [] } = obj
			if (!type) continue

			const prop = name =>
				Array.isArray(properties)
					? properties.find(p => p.name === name)?.value
					: properties?.[name]

			const cx = x + width / 2
			const cy = y + height / 2

			// ── Универсальный обработчик px-* параллакс-слоёв ────────────────────
			// Тип объекта = ключ текстуры (px-sky, px-mtn, px-clouds-near, etc.)
			// Поведение определяется таблицей PX_CFG ниже.
			if (type.startsWith('px-')) {
				// Порядок слоёв (сзади → вперёд):
				//   px-sky(-5) → px-mtn(-4) → px-clouds-far(-3) → px-clouds-near(-2) → px-clouds-btm(-1)
				//   → тайлы Tiled: back(1), остальные(4) → игроки(10)
				// Порядок от дальнего к ближнему: sky(-5) → clouds-near(-4) → mtn(-3) → clouds-far(-2) → clouds-btm(-1)
				// sfX    = параллакс-доля камеры: чем ближе слой, тем больше (0=стоит, 1=вместе с миром)
				// driftX = авто-дрейф влево, canvas px/s: чем ближе слой, тем быстрее
				//          Celeste-стиль: 0–3 px/s, суб-пиксель на кадр → без видимых ступенек
				// ts     = масштаб тайла: 180/324 подгоняет PNG 576×324 под холст 320×180
				const PX_CFG = {
					'px-sky': {
						mode: 'tile',
						sfX: 0.04,
						sfY: 0.01,
						depth: -5,
						alpha: 1.0,
						driftX: 0,
						ts: 1,
					},
					'px-clouds-near': {
						mode: 'tile',
						sfX: 0.12,
						sfY: 0,
						depth: -4,
						alpha: 1.0,
						driftX: 6,
						ts: 180 / 324,
					},
					'px-mtn': {
						mode: 'tile',
						sfX: 0.2,
						sfY: 0,
						depth: -3,
						alpha: 1.0,
						driftX: 9,
						ts: 180 / 324,
					},
					'px-clouds-far': {
						mode: 'tile',
						sfX: 0.32,
						sfY: 0,
						depth: -2,
						alpha: 1.0,
						driftX: 14,
						ts: 180 / 324,
					},
					'px-clouds-btm': {
						mode: 'tile',
						sfX: 0.46,
						sfY: 0,
						depth: -1,
						alpha: 1.0,
						driftX: 18,
						ts: 180 / 324,
					},
				}
				const cfg = PX_CFG[type]
				if (!cfg) {
					tlog(`[PxLayer] ⚠ "${type}" не в таблице PX_CFG — добавь запись`)
				} else if (!this.textures.exists(type)) {
					tlog(`[PxLayer] ✗ "${type}" не загружена — добавь в PreloadScene.js`)
				} else {
					const src = this.textures.get(type).source[0]
					const alpha = prop('alpha') ?? cfg.alpha
					const depth = prop('depth') ?? cfg.depth

					if (cfg.mode === 'tile') {
						const sfX = prop('sfX') ?? cfg.sfX
						const sfY = prop('sfY') ?? cfg.sfY
						const ts = cfg.ts ?? 1
						const spr = this.add
							.tileSprite(0, 0, 320, 180, type)
							.setOrigin(0, 0)
							.setScrollFactor(0)
							.setAlpha(alpha)
							.setDepth(depth)
							.setTileScale(ts, ts)
						this._parallaxLayers.push({
							sprite: spr,
							sfX,
							sfY,
							driftX: cfg.driftX ?? 0,
							driftY: 0,
							_driftAccX: 0,
							_driftAccY: 0,
						})
						tlog(
							`[PxLayer] ✓ TILE  "${type}"  PNG=${src.width}×${src.height}  sfX=${sfX} sfY=${sfY}  driftX=${cfg.driftX ?? 0}  ts=${ts.toFixed(3)}  depth=${depth}`,
						)
					} else {
						// Позиционированное изображение — центр в точке объекта Tiled.
						// Авто-scale: 1 PNG-пиксель → 1 экранный пиксель
						// displayScale = во сколько Phaser растягивает канвас до экрана (2К=8, 1080p=6, 720p=4)
						// game.scale.displayScale не готово в create() → берём из video-настроек
						// Переопредели через свойство Tiled 'scale' если нужен другой размер
						const _res =
							SaveSystem.getSettings().video?.resolution || '1920x1080'
						const displayScale = Math.max(
							1,
							Math.round((Number(_res.split('x')[0]) || 1920) / 320),
						)
						const scale = prop('scale') ?? 5 / displayScale
						const spr = this.add
							.image(x, y, type)
							.setOrigin(0.5, 0.5)
							.setScrollFactor(1, 1)
							.setAlpha(alpha)
							.setDepth(depth)
							.setScale(scale)
						const dispW = src.width * scale
						const dispH = src.height * scale
						const tilesW = (dispW / 16).toFixed(1)
						const tilesH = (dispH / 16).toFixed(1)
						tlog(
							`[PxLayer] ✓ IMAGE "${type}" @ world(${Math.round(x)},${Math.round(y)})  PNG=${src.width}×${src.height}  ÷${displayScale} → scale=${scale.toFixed(3)} → ${Math.round(dispW)}×${Math.round(dispH)} canvas px = ${tilesW}×${tilesH} тайлов  depth=${depth}`,
						)
					}
				}
				continue // не передавать px-* в switch ниже
			}

			switch (type) {
				case 'ground':
					this._makePlatform(cx, cy, width, height, 'tile-ground')
					break
				case 'platform':
					this._makePlatform(cx, cy, width, height, 'tile-platform')
					break
				case 'spawn':
					this._spawnFromMap = { x, y }
					break
				case 'exit':
					this._makeExitZone(x, y)
					break
				case 'orb':
					// Invisible physics body — sprite to be added later
					this.orb = this.physics.add
						.staticImage(x, y, 'orb')
						.setVisible(false)
						.setDisplaySize(28, 28)
						.refreshBody()
					break
				case 'plate':
					// Invisible physics body — sprite to be added later
					this.pressurePlate = this.physics.add
						.staticImage(x, y, 'plate')
						.setVisible(false)
						.setDisplaySize(48, 16)
						.refreshBody()
					break
				case 'door':
					// Invisible physics body — sprite to be added later
					this.door = this.physics.add
						.staticImage(x, y, 'door')
						.setVisible(false)
						.setDisplaySize(48, 80)
						.refreshBody()
					this.doorBody = this.door
					break
				case 'sign': {
					// Only text, no background image — sign sprite to be added later
					const text = prop('text') || ''
					this._makeSign(x, y, text)
					break
				}
			}
		}
	}

	_buildLevel10() {
		const H = WORLD_H,
			W = WORLD_W

		this._makePlatform(W / 2, H - 32, W, 64, 'tile-ground')

		let y = H - 150
		for (let i = 0; i < 30; i++) {
			const x = 150 + Math.sin(i * 0.8) * 400 + 440
			y -= 80 + Math.random() * 60
			this._makePlatform(x, y, 100 + Math.random() * 80, 20, 'tile-platform')
		}

		this._makePlatform(W / 2, 200, 300, 20, 'tile-ground')
		this._makeExitZone(W / 2, 170)

		this.add
			.text(W / 2, 120, '🏔 Вершина горы!', {
				fontSize: '28px',
				color: '#ffd700',
				fontFamily: 'Cinzel, serif',
			})
			.setOrigin(0.5)
			.setDepth(10)
	}

	_buildStub() {
		const H = WORLD_H,
			W = WORLD_W
		this._makePlatform(W / 2, H - 32, W, 64, 'tile-ground')
		this._makePlatform(W / 2, H - 200, 300, 20, 'tile-platform')
		this._makeExitZone(W / 2, H - 230)
		this.add
			.text(W / 2, H - 320, `Уровень ${this.levelId}\n(В разработке)`, {
				fontSize: '24px',
				color: '#ffffff66',
				align: 'center',
				fontFamily: 'Cinzel, serif',
			})
			.setOrigin(0.5)
	}

	_makePlatform(x, y, w, h, tex) {
		// When Tiled tile layers are rendered, visuals come from the map — skip tileSprite
		// to avoid drawing duplicate graphics on top of each other.
		// When no tile layers (fallback / stub levels), draw a tileSprite for visuals.
		if (!this._useTiledVisuals) {
			this.add.tileSprite(x, y, w, h, tex).setDepth(5)
		}
		// Physics body is always invisible; its hitbox matches the object rectangle
		const body = this.physics.add.staticImage(x, y, tex).setVisible(false)
		body.setDisplaySize(w, h).refreshBody()
		this.platforms.add(body)
		return body
	}

	_makeSign(x, y, text) {
		// No background sprite — just the text floating, readable via stroke
		// Replace with proper sign sprite when pixel art is ready
		this.add
			.text(x, y - 12, text, {
				fontSize: '10px',
				color: '#ffffff',
				fontFamily: 'Arial, sans-serif',
				align: 'center',
				stroke: '#000000',
				strokeThickness: 3,
			})
			.setOrigin(0.5)
			.setDepth(7)
	}

	_addOrbGlow(x, y) {
		const glow = this.add.circle(x, y, 22, 0xffd700, 0.15).setDepth(7)
		this.tweens.add({
			targets: glow,
			alpha: 0.4,
			duration: 900,
			yoyo: true,
			repeat: -1,
		})
		this.tweens.add({
			targets: this.orb,
			y: y - 6,
			duration: 1200,
			yoyo: true,
			repeat: -1,
		})
	}

	_makeExitZone(x, y) {
		const zone = this.add.zone(x, y, 80, 40).setDepth(9)
		this.physics.world.enable(zone)
		zone.body.allowGravity = false
		this.add
			.text(x, y, '▲ ВЫХОД', {
				fontSize: '12px',
				color: '#4ade80',
				fontFamily: 'Cinzel, serif',
			})
			.setOrigin(0.5)
			.setDepth(10)
		this._exitZone = zone
	}

	_requestExit() {
		if (this._exiting) return
		this._gamePaused = false
		console.log('[GameScene] ESC → exit')
		networkClient.exitGame()
		this._exitGame(false, false)
	}

	_exitLevel() {
		if (this._exiting) return
		this._exiting = true
		console.log('[GameScene] Exit! Level', this.levelId, 'complete')

		// Update per-slot level progress (for host AND guest)
		const newLevel = Math.min(this.levelId + 1, 10)
		window.__currentSlotMaxLevel = newLevel // always update (both roles)
		const slot = window.__currentSlot
		if (slot !== undefined) {
			SaveSystem.setSave(slot, { level: newLevel })
		}
		SaveSystem.setMaxLevel(newLevel)

		networkClient.levelComplete()
		this._showLevelComplete()
	}

	_showLevelComplete() {
		// Canvas is 320×180 — setScrollFactor(0) pins to screen, positions in screen px
		const cx = 160,
			cy = 90
		const nextLevel = Math.min(this.levelId + 1, 10)
		const isLast = this.levelId >= 10

		this.add
			.rectangle(cx, cy, 320, 180, 0x000000, 0.85)
			.setScrollFactor(0)
			.setDepth(100)
		this.add
			.text(
				cx,
				cy - 44,
				isLast ? '🏆 ИГРА ПРОЙДЕНА!' : `УРОВЕНЬ ${this.levelId} ПРОЙДЕН!`,
				{
					fontSize: '14px',
					color: '#ffd700',
					fontFamily: 'Cinzel Decorative, serif',
					shadow: {
						offsetX: 0,
						offsetY: 0,
						color: '#ffd700',
						blur: 8,
						fill: true,
					},
				},
			)
			.setOrigin(0.5)
			.setScrollFactor(0)
			.setDepth(101)

		if (this.role === 'host') {
			if (!isLast) {
				const nextBtn = this.add
					.text(cx, cy - 6, `▶  Уровень ${nextLevel}`, {
						fontSize: '11px',
						color: '#4ade80',
						fontFamily: 'Cinzel, serif',
						padding: { x: 8, y: 4 },
					})
					.setOrigin(0.5)
					.setScrollFactor(0)
					.setDepth(101)
					.setInteractive({ useHandCursor: true })

				nextBtn.on('pointerover', () => nextBtn.setColor('#ffffff'))
				nextBtn.on('pointerout', () => nextBtn.setColor('#4ade80'))
				nextBtn.on('pointerup', () => {
					console.log('[GameScene] Host → next level', nextLevel)
					saveSessionPlaytime()
					window.__l2s = { ...window.__l2s, levelId: nextLevel }
					networkClient.startGame(nextLevel)
					this.time.delayedCall(80, () => {
						this._netUnsub.forEach(u => u())
						this._netUnsub = []
						this.scene.restart({ levelId: nextLevel, role: 'host' })
					})
				})
			}

			const menuBtn = this.add
				.text(cx, cy + 22, '◀  Выбор уровня', {
					fontSize: '9px',
					color: '#888888',
					fontFamily: 'Cinzel, serif',
					padding: { x: 8, y: 4 },
				})
				.setOrigin(0.5)
				.setScrollFactor(0)
				.setDepth(101)
				.setInteractive({ useHandCursor: true })

			menuBtn.on('pointerover', () => menuBtn.setColor('#ffffff'))
			menuBtn.on('pointerout', () => menuBtn.setColor('#888888'))
			menuBtn.on('pointerup', () => {
				networkClient.exitGame()
				this._netUnsub.forEach(u => u())
				this._netUnsub = []
				this.scene.stop()
				exitToLevelSelect()
			})
		} else {
			this.add
				.text(cx, cy + 10, 'Ожидание хоста…', {
					fontSize: '9px',
					color: '#888888',
					fontFamily: 'Cinzel, serif',
				})
				.setOrigin(0.5)
				.setScrollFactor(0)
				.setDepth(101)
		}
	}

	_exitGame(completed = false, notify = true) {
		if (this._exiting && !completed) return
		this._exiting = true
		if (notify) networkClient.exitGame()
		this._netUnsub.forEach(u => u())
		this._netUnsub = []
		// Save playtime for this session
		saveSessionPlaytime()
		this.scene.stop()
		exitToLevelSelect()
	}
}
