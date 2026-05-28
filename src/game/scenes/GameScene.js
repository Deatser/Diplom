import Phaser from 'phaser'
import { Player } from '../entities/Player.js'
import { networkClient } from '../../network/NetworkClient.js'
import { SaveSystem } from '../../systems/SaveSystem.js'
import {
	exitToLevelSelect,
	saveSessionPlaytime,
	togglePause,
} from '../GameManager.js'

// Форматирует KeyboardEvent.code в читаемую метку для подсказок.
function keyCodeToLabel(code) {
	if (!code) return '?'
	const map = {
		ShiftLeft: 'Shift',
		ShiftRight: 'Shift',
		ControlLeft: 'Ctrl',
		ControlRight: 'Ctrl',
		AltLeft: 'Alt',
		AltRight: 'Alt',
		Space: 'Пробел',
		ArrowLeft: '←',
		ArrowRight: '→',
		ArrowUp: '↑',
		ArrowDown: '↓',
		Backquote: '`',
		BracketLeft: '[',
		BracketRight: ']',
		Semicolon: ';',
		Quote: "'",
		Comma: ',',
		Period: '.',
		Slash: '/',
		Minus: '-',
		Equal: '=',
		Backslash: '\\',
	}
	if (map[code]) return map[code]
	if (code.startsWith('Key')) return code.slice(3)
	if (code.startsWith('Digit')) return code.slice(5)
	return code
}

// Показывает/скрывает HK-стилизованный prompt с CSS-анимациями.
// onHidden — опциональный callback после завершения exit-анимации.
function _showHkPrompt(el, visible, onHidden) {
	if (visible) {
		el.style.display = ''
		el.querySelectorAll('.hk-orn, .hk-text').forEach(c => {
			c.style.animation = 'none'
			void c.offsetWidth
			c.style.animation = ''
		})
		return
	}
	// Exit animations
	const top = el.querySelector('.hk-orn-top')
	const bot = el.querySelector('.hk-orn-bot')
	const txt = el.querySelector('.hk-text')
	const reset = c => {
		c.style.animation = 'none'
		void c.offsetWidth
	}
	if (top) {
		reset(top)
		top.style.animation = 'hkOrnTopOut 0.30s ease-in forwards'
	}
	if (bot) {
		reset(bot)
		bot.style.animation = 'hkOrnBottomOut 0.30s ease-in forwards'
	}
	if (txt) {
		reset(txt)
		txt.style.animation = 'hkTextOut 0.25s ease-in forwards'
	}
	setTimeout(() => {
		el.style.display = 'none'
		el.querySelectorAll('.hk-orn, .hk-text').forEach(
			c => (c.style.animation = ''),
		)
		onHidden?.()
	}, 320)
}

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
		this._orbNearby = false // игрок в зоне подбора орба
		this._orbInteracting = false // ЛКМ нажата, анимация атаки играет
		this._orbPromptEl = null // DOM элемент «Собрать» над орбом
		this._worldLabels = [] // [{el,wx,wy}] DOM текст в мировых координатах
		this._levelCompleteEl = null // DOM оверлей завершения уровня
		this._abilityOverlayEl = null // DOM оверлей получения способности
		this._inputLocked = false // true → updateLocal пропускается (кинематик)

		this._localTrail = null // { g: Graphics, pts: [] } — trail дэша local
		this._remoteTrail = null // trail дэша remote
		this._testOrbs = [] // тестовые орбы для анимаций
		this._exiting = false
		this._gamePaused = false
		this._exitZone = null
		this._parallaxLayers = [] // [{sprite, sfX, sfY, driftX, driftY, _driftAccX, _driftAccY}]
		this._driftSprites = [] // [{spr, velX, _acc}] — декоративные спрайты с pixel-точным движением
		console.log('[GameScene] init levelId=', this.levelId, 'role=', this.role)
	}

	create() {
		// displayScale = во сколько раз Phaser масштабирует canvas 320×180 до экрана.
		// setResolution(ds) заставляет текст рендериться в ds× выше → HD качество.
		const _res = SaveSystem.getSettings().video?.resolution || '1920x1080'
		this._ds = Math.max(
			2,
			Math.round((Number(_res.split('x')[0]) || 1920) / 320),
		)

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

		const localTex = this.role === 'host' ? 'blue-knight' : 'orange-knight'
		const remoteTex = this.role === 'host' ? 'orange-knight' : 'blue-knight'

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
					// Убрать world-space метки у гостя тоже
					for (const lbl of this._worldLabels) lbl.el?.remove()
					this._worldLabels = []
					this._orbPromptEl?.remove()
					this._orbPromptEl = null
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
				// Убрать level-complete оверлей и world-метки немедленно — не ждать shutdown()
				this._levelCompleteEl?.remove()
				this._levelCompleteEl = null
				for (const lbl of this._worldLabels) lbl.el?.remove()
				this._worldLabels = []
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
			// DOM prompt — crisp HD text above the orb, Hollow Knight–style frame
			this._orbPromptEl = document.createElement('div')
			this._orbPromptEl.className = 'hud-world-label hud-world-prompt'
			this._orbPromptEl.innerHTML = `
				<img class="hk-orn hk-orn-top" src="/assets/pngfortext/top.png" onerror="this.style.display='none'" />
				<span class="hk-text">[ЛКМ] Собрать</span>
				<img class="hk-orn hk-orn-bot" src="/assets/pngfortext/bottom.png" onerror="this.style.display='none'" />
			`
			this._orbPromptEl.style.display = 'none'
			document.getElementById('hud-prompts').appendChild(this._orbPromptEl)

			// ЛКМ → сбор орба / тестовые орбы
			this.input.on('pointerdown', ptr => {
				if (!ptr.leftButtonDown()) return
				// Основной орб (однократно)
				if (this._orbNearby && !this._orbCollected && !this._orbInteracting) {
					this._startOrbCollection()
					return
				}
				// Тестовые орбы (бесконечно)
				const nearby = this._testOrbs.find(o => o.nearby)
				if (nearby) this._interactTestOrb(nearby)
			})
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

		if (!this._inputLocked) this.localPlayer.updateLocal(this.keys, delta, time)
		this._updateCamera(delta)
		this._updateParallax(delta)
		this._updateDriftSprites(delta)
		this._updateDomPositions()

		// Dash smoke trail — каждый кадр дэша пишем точку, рисуем шлейф
		this._tickDashTrail(
			this.localPlayer,
			'_localTrail',
			this.localPlayer._dashActive,
		)
		this._tickDashTrail(
			this.remotePlayer,
			'_remoteTrail',
			this.remotePlayer._netDashActive,
		)

		// Test orb proximity prompts (infinite reuse)
		for (const torb of this._testOrbs) {
			const dist = Phaser.Math.Distance.Between(
				this.localPlayer.x,
				this.localPlayer.y,
				torb.body.x,
				torb.body.y,
			)
			const nearby = dist < 40
			if (nearby !== torb.nearby) {
				torb.nearby = nearby
				_showHkPrompt(torb.promptEl, nearby)
			}
		}

		// Orb proximity prompt
		if (this.orb?.active && !this._orbCollected && !this._orbInteracting) {
			const dist = Phaser.Math.Distance.Between(
				this.localPlayer.x,
				this.localPlayer.y,
				this.orb.x,
				this.orb.y,
			)
			const nearby = dist < 40
			if (nearby !== this._orbNearby) {
				this._orbNearby = nearby
				if (this._orbPromptEl) _showHkPrompt(this._orbPromptEl, nearby)
			}
		}

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

	// ── Dash smoke trail (Hollow Knight Mothwing Cloak style) ─────────────────
	// Каждый кадр дэша: добавляем точку и перерисовываем шлейф.
	// Когда дэш заканчивается — весь шлейф плавно исчезает.
	_tickDashTrail(player, trailKey, isDashing) {
		if (isDashing) {
			if (!this[trailKey]) {
				this[trailKey] = { g: this.add.graphics().setDepth(9), pts: [] }
			}
			this[trailKey].pts.push({ x: player.x, y: player.y + 2 })
			this._redrawDashTrail(this[trailKey], player._charPrefix)
		} else if (this[trailKey]) {
			const g = this[trailKey].g
			this[trailKey] = null
			this.tweens.add({
				targets: g,
				alpha: 0,
				duration: 180,
				ease: 'Quad.easeIn',
				onComplete: () => g.destroy(),
			})
		}
	}

	_redrawDashTrail(trail, charPrefix) {
		const g = trail.g
		const pts = trail.pts
		const n = pts.length

		// ADD blending: цвета суммируются → нет грязных пятен от перекрытия,
		// получается мягкое свечение. Цвета подобраны светлее оригинала
		// чтобы при ADD они были заметны.
		g.setBlendMode(Phaser.BlendModes.ADD)

		const c1 = charPrefix === 'orange' ? 0xbb6200 : 0x3a5899
		const c2 = charPrefix === 'orange' ? 0x7a3800 : 0x1e2f55

		g.clear()
		for (let i = 0; i < n; i++) {
			const t = n > 1 ? i / (n - 1) : 1
			const a = 0.15 + t * 0.75 // 0.15→0.90
			const rw = 3 + t * 7 // 3→10 px
			const rh = 5 + t * 10 // 5→15 px
			g.fillStyle(t > 0.4 ? c1 : c2, a)
			g.fillEllipse(pts[i].x, pts[i].y, rw, rh)
		}
	}

	// ── OLD dash effect (больше не используется, оставлен для совместимости) ──
	spawnDashEffect(x, y, facingRight, charPrefix) {
		const dir = facingRight ? 1 : -1

		const palette =
			charPrefix === 'orange' ? [0x743f00, 0x512000] : [0x242f46, 0x141326]

		const g = this.add.graphics().setDepth(9)

		// dX  = сдвиг старта линии по направлению дэша
		// dY  = вертикальное смещение от позиции игрока (0=голова, 22=ноги)
		// len = длина в канвас-пикселях (нерегулярно)
		// a   = прозрачность
		// c   = цвет (0 или 1 из palette)
		// b   = bend 1px: >0 загиб вниз, <0 загиб вверх, 0 прямая
		const streaks = [
			{ dX: 0, dY: 0, len: 18, a: 0.75, c: 0, b: 1 },
			{ dX: 3, dY: 3, len: 11, a: 0.55, c: 1, b: 1 },
			{ dX: 0, dY: 5, len: 26, a: 0.9, c: 0, b: 1 },
			{ dX: 4, dY: 8, len: 7, a: 0.45, c: 1, b: 0 },
			{ dX: 1, dY: 11, len: 31, a: 1.0, c: 0, b: 0 },
			{ dX: 0, dY: 13, len: 9, a: 0.6, c: 1, b: 0 },
			{ dX: 2, dY: 15, len: 22, a: 0.8, c: 0, b: -1 },
			{ dX: 0, dY: 18, len: 14, a: 0.65, c: 1, b: -1 },
			{ dX: 4, dY: 21, len: 6, a: 0.4, c: 0, b: -1 },
			{ dX: 1, dY: 9, len: 17, a: 0.7, c: 1, b: 0 },
		]

		for (const s of streaks) {
			const x1 = x + dir * s.dX
			const x2 = x1 - dir * s.len
			const yL = y + s.dY
			const midX = (x1 + x2) / 2
			g.lineStyle(1, palette[s.c], s.a)
			g.beginPath()
			g.moveTo(x1, yL)
			if (s.b !== 0) {
				// 1px загиб через среднюю точку — два отрезка вместо кривой Безье
				g.lineTo(midX, yL + s.b)
				g.lineTo(x2, yL)
			} else {
				g.lineTo(x2, yL)
			}
			g.strokePath()
		}

		this.tweens.add({
			targets: g,
			alpha: 0,
			duration: 640,
			ease: 'Quad.easeOut',
			onComplete: () => g.destroy(),
		})
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

	// ЛКМ рядом с орбом — запуск полного кинематического сценария
	_startOrbCollection() {
		this._orbInteracting = true
		this._orbNearby = false
		this._inputLocked = true // отключить управление на всё время заставки

		// Параллельно: fade-out HK-рамки + начало атаки
		if (this._orbPromptEl) _showHkPrompt(this._orbPromptEl, false)
		this.localPlayer.playAttack()

		// После последнего кадра атаки: заморозить персонажа
		// Player.playAttack() регистрирует .once первым (сбрасывает _animState='idle'),
		// наш .once регистрируется следом — гарантированно выполняется вторым.
		const attackKey = this.localPlayer._charPrefix + '-attack'
		this.localPlayer.once('animationcomplete-' + attackKey, () => {
			// Откатить на предпоследний кадр анимации атаки
			const anim = this.localPlayer.anims.currentAnim
			if (anim?.frames.length >= 2) {
				this.localPlayer.setFrame(
					anim.frames[anim.frames.length - 2].textureFrame,
				)
			}
			// Заморозить физику — персонаж висит на предпоследнем кадре
			this.localPlayer.body.setVelocity(0, 0)
			this.localPlayer.body.setAllowGravity(false)
			// Выдержать 0.5s замершего кадра, затем перейти к сбору
			this.time.delayedCall(500, () => this._collectOrb())
		})
	}

	// Тестовый орб — бесконечное взаимодействие, только анимация
	_interactTestOrb(orb) {
		const p = this.localPlayer
		switch (orb.type) {
			case 'orbtestattack':
				p.playAttack()
				break
			case 'orbtesthit':
				p.playHit()
				break
			case 'orbtestdeath':
				p.playDead()
				break
			case 'orbtestshield':
				p.playShieldToggle()
				break
		}
	}

	// Вызывается после заморозки (0.5s после последнего кадра атаки)
	_collectOrb() {
		if (this._orbCollected) return
		this._orbCollected = true
		this._orbPromptEl?.remove()
		this._orbPromptEl = null
		this.orb?.destroy()

		const abilityName = this._getLevelAbility()
		if (abilityName) {
			this.localPlayer.unlock(abilityName)
			this.remotePlayer.unlock(abilityName)
			console.log('[GameScene] ORB collected! Ability:', abilityName)
		}
		this._updateHUD()

		// Нет способности → разморозить сразу, нет смысла показывать оверлей
		if (!abilityName) {
			this._unfreezeAfterOrb()
			return
		}

		this._showAbilityUnlock(abilityName)
	}

	_showAbilityUnlock(name) {
		const labels = {
			dash: 'Воздушный рывок',
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

		// Читаем актуальные биндинги из настроек
		const kb = SaveSystem.getSettings().keybindings || {}
		const K = code => `<span class="ao-key">${keyCodeToLabel(code)}</span>`

		const hints = {
			dash: `Нажмите ${K(kb.dash || 'ShiftLeft')} на земле или в прыжке, чтобы устремиться вперёд`,
			doubleJump: `Нажмите ${K(kb.jump || 'Space')} повторно в воздухе для второго прыжка`,
			wallCling: `Прижмитесь к стене и удерживайте направление — скольжение замедляет падение`,
			groundSlam: `В воздухе зажмите ${K(kb.down || 'KeyS')} чтобы с силой ударить о землю`,
			airDive: `В воздухе зажмите ${K(kb.dash || 'ShiftLeft')} + вниз для стремительного рывка`,
			grapple: `ПКМ чтобы выпустить крюк-кошку`,
			glide: `Удерживайте ${K(kb.jump || 'Space')} в воздухе для медленного парения`,
			conjurePlatform: `ПКМ чтобы создать временную платформу под ногами`,
			swap: `ПКМ чтобы мгновенно поменяться местами с партнёром`,
			chargedDash: `Удерживайте ${K(kb.dash || 'ShiftLeft')} для заряженного рывка`,
		}

		const el = document.createElement('div')
		el.className = 'game-fullscreen-overlay'
		el.innerHTML = `
			<div class="ao-subtitle">Открыто:</div>
			<div class="ao-name">${labels[name] || name}</div>
			<div class="ao-tip">${hints[name] || ''}</div>
			<img class="ao-lmb" src="/assets/pngfortext/mouseleft.png" onerror="this.style.display='none'" />
		`
		document.getElementById('hud-overlay').appendChild(el)
		this._abilityOverlayEl = el

		// Overlay перехватывает клики раньше Phaser-canvas → DOM-listener.
		// Задержка: overlay 0.5s + name 0.35+0.45s + tip 0.85+0.5s + lmb 1.9+0.4s ≈ 2.3s
		// Даём 2.5s — к этому моменту всё появилось, случайный клик исключён.
		setTimeout(() => {
			el.addEventListener('click', () => this._dismissAbilityOverlay(), {
				once: true,
			})
		}, 2500)
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
			dash: 'Рывок',
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
					const text = prop('text') || ''
					this._makeSign(x, y, text)
					break
				}
				case 'orbtestattack':
				case 'orbtesthit':
				case 'orbtestdeath':
				case 'orbtestshield': {
					const testBody = this.physics.add
						.staticImage(x, y, 'orb')
						.setVisible(false)
						.setDisplaySize(28, 28)
						.refreshBody()
					const testLabels = {
						orbtestattack: '[ЛКМ] Атака',
						orbtesthit: '[ЛКМ] Урон',
						orbtestdeath: '[ЛКМ] Смерть',
						orbtestshield: '[ЛКМ] Щит ⇄',
					}
					const testPromptEl = document.createElement('div')
					testPromptEl.className = 'hud-world-label hud-world-prompt-test'
					testPromptEl.innerHTML = `
						<img class="hk-orn hk-orn-top" src="/assets/pngfortext/top.png" onerror="this.style.display='none'" />
						<span class="hk-text">${testLabels[type]}</span>
						<img class="hk-orn hk-orn-bot" src="/assets/pngfortext/bottom.png" onerror="this.style.display='none'" />
					`
					testPromptEl.style.display = 'none'
					document.getElementById('hud-prompts').appendChild(testPromptEl)
					this._testOrbs.push({
						body: testBody,
						type,
						promptEl: testPromptEl,
						wx: x,
						wy: y - 22,
						nearby: false,
					})
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

		const peakEl = document.createElement('div')
		peakEl.className = 'hud-world-label hud-world-sign'
		peakEl.textContent = '🏔 Вершина горы!'
		peakEl.style.fontSize = '1.2rem'
		peakEl.style.color = '#ffd700'
		peakEl.style.textShadow = '0 0 16px #ffd700'
		document.getElementById('hud-prompts').appendChild(peakEl)
		this._worldLabels.push({ el: peakEl, wx: W / 2, wy: 120 })
	}

	_buildStub() {
		const H = WORLD_H,
			W = WORLD_W
		this._makePlatform(W / 2, H - 32, W, 64, 'tile-ground')
		this._makePlatform(W / 2, H - 200, 300, 20, 'tile-platform')
		this._makeExitZone(W / 2, H - 230)
		const stubEl = document.createElement('div')
		stubEl.className = 'hud-world-label hud-world-sign'
		stubEl.innerHTML = `Уровень ${this.levelId}<br>(В разработке)`
		stubEl.style.color = 'rgba(255,255,255,0.4)'
		stubEl.style.textAlign = 'center'
		document.getElementById('hud-prompts').appendChild(stubEl)
		this._worldLabels.push({ el: stubEl, wx: W / 2, wy: H - 320 })
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
		const el = document.createElement('div')
		el.className = 'hud-world-label hud-world-sign'
		el.textContent = text
		document.getElementById('hud-prompts').appendChild(el)
		this._worldLabels.push({ el, wx: x, wy: y - 12 })
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
		const el = document.createElement('div')
		el.className = 'hud-world-label hud-world-exit'
		el.textContent = '▲ ВЫХОД'
		document.getElementById('hud-prompts').appendChild(el)
		this._worldLabels.push({ el, wx: x, wy: y })
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

		// Убрать все world-space метки немедленно — они не нужны после выхода с уровня
		for (const lbl of this._worldLabels) lbl.el?.remove()
		this._worldLabels = []
		this._orbPromptEl?.remove()
		this._orbPromptEl = null

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
		const nextLevel = Math.min(this.levelId + 1, 10)
		const isLast = this.levelId >= 10
		const titleText = isLast
			? '🏆 ИГРА ПРОЙДЕНА!'
			: `УРОВЕНЬ ${this.levelId} ПРОЙДЕН!`

		const el = document.createElement('div')
		el.className = 'game-fullscreen-overlay'
		el.innerHTML = `<div class="game-overlay-title">${titleText}</div>`

		if (this.role === 'host') {
			if (!isLast) {
				const nextBtn = document.createElement('button')
				nextBtn.className = 'game-btn game-btn-primary'
				nextBtn.textContent = `▶  Уровень ${nextLevel}`
				nextBtn.addEventListener('click', () => {
					el.remove()  // убрать оверлей немедленно — не ждать shutdown()
					this._levelCompleteEl = null
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
				el.appendChild(nextBtn)
			}
			const menuBtn = document.createElement('button')
			menuBtn.className = 'game-btn'
			menuBtn.textContent = '◀  Выбор уровня'
			menuBtn.addEventListener('click', () => {
				networkClient.exitGame()
				this._netUnsub.forEach(u => u())
				this._netUnsub = []
				this.scene.stop()
				exitToLevelSelect()
			})
			el.appendChild(menuBtn)
		} else {
			const waiting = document.createElement('div')
			waiting.className = 'game-overlay-subtitle'
			waiting.style.color = 'rgba(255,255,255,0.45)'
			waiting.textContent = 'Ожидание хоста…'
			el.appendChild(waiting)
		}

		document.getElementById('hud-overlay').appendChild(el)
		this._levelCompleteEl = el
	}

	// Converts a world-space point to viewport CSS px — used to position DOM labels.
	_worldToScreen(wx, wy) {
		const cam = this.cameras.main
		const rect = this.game.canvas.getBoundingClientRect()
		const sx =
			(wx - cam.scrollX) * cam.zoom * (rect.width / this.game.config.width)
		const sy =
			(wy - cam.scrollY) * cam.zoom * (rect.height / this.game.config.height)
		return { x: rect.left + sx, y: rect.top + sy }
	}

	// Called every frame — keeps DOM label positions in sync with the camera.
	// Position is updated as long as the element is VISIBLE (display !== 'none'),
	// including during exit animations — prevents "drifting" while fading out.
	_updateDomPositions() {
		for (const lbl of this._worldLabels) {
			const p = this._worldToScreen(lbl.wx, lbl.wy)
			lbl.el.style.left = p.x + 'px'
			lbl.el.style.top = p.y + 'px'
		}
		if (
			this._orbPromptEl &&
			this._orbPromptEl.style.display !== 'none' &&
			this.orb?.active
		) {
			const p = this._worldToScreen(this.orb.x, this.orb.y - 22)
			this._orbPromptEl.style.left = p.x + 'px'
			this._orbPromptEl.style.top = p.y + 'px'
		}
		for (const torb of this._testOrbs) {
			if (torb.promptEl.style.display !== 'none') {
				const p = this._worldToScreen(torb.wx, torb.wy)
				torb.promptEl.style.left = p.x + 'px'
				torb.promptEl.style.top = p.y + 'px'
			}
		}
	}

	// ЛКМ на оверлее — плавно скрыть, потом разморозить персонажа
	_dismissAbilityOverlay() {
		if (!this._abilityOverlayEl) return
		const el = this._abilityOverlayEl
		this._abilityOverlayEl = null
		el.classList.add('hiding') // запускает CSS-анимацию overlayOut
		setTimeout(() => {
			el.remove()
			this._unfreezeAfterOrb()
		}, 500)
	}

	// Разморозить физику и ввод после кинематика сбора орба
	_unfreezeAfterOrb() {
		this.localPlayer.body.setAllowGravity(true)
		// Принудительно вернуть idle-анимацию — _animState уже 'idle' после атаки,
		// но спрайт завис на последнем кадре, поэтому play() нужен явно.
		this.localPlayer._animState = ''
		this.localPlayer.play(this.localPlayer._charPrefix + '-idle')
		this.localPlayer._animState = 'idle'
		this._inputLocked = false
	}

	// Phaser lifecycle — called on scene stop/restart. Cleans up all DOM elements.
	shutdown() {
		// Явно удалить каждый отслеживаемый элемент
		this._levelCompleteEl?.remove()
		this._abilityOverlayEl?.remove()
		this._orbPromptEl?.remove()
		for (const lbl of this._worldLabels)  lbl.el?.remove()
		for (const torb of this._testOrbs)    torb.promptEl?.remove()

		// Сбросить контейнеры полностью на случай если что-то пропустили
		const hp = document.getElementById('hud-prompts')
		const ho = document.getElementById('hud-overlay')
		if (hp) hp.innerHTML = ''
		if (ho) ho.innerHTML = ''

		this._worldLabels      = []
		this._orbPromptEl      = null
		this._abilityOverlayEl = null
		this._levelCompleteEl  = null
		this._inputLocked      = false
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
