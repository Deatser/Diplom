import Phaser from 'phaser'

// ── Пиксельный дождь «Dead Cells» поверх всего ───────────────────────────────
//
// Полностью процедурный — без ассетов. Рисуется в один Graphics в экранном
// пространстве (scrollFactor 0) на холсте 320×180, depth=1000 → выше игроков (10).
//
// Бесшовность и бесконечность достигаются wrap-логикой: капля, ушедшая за низ,
// перерождается сверху со случайным x → визуально вечный поток без швов.
//
// Все координаты округляются до целого canvas-пикселя — при ×6/×8 апскейле
// pixelArt:true даёт чёткие «кубики» как в референсе, без сглаживания.
//
// Слои:
//   far  — тусклые тонкие медленные штрихи (создают глубину)
//   near — яркие длинные быстрые штрихи с белой «головой»
//   speck — мерцающие синие пиксели-брызги в воздухе
//   splash — короткие всплески у нижнего края экрана (fallback, если нет зон)
//   ground — процедурные брызги НА ПОЛУ в мировых точках (splashZones из Tiled)
//
// Наклон отрицательный (ветер слева) — капли летят вниз-влево, хвост вверх-вправо,
// как на референсе.
//
// Брызги на полу: splashZones — массив {x, y, w} в мировых координатах (объекты
// type:"rain" слоя rainlayer). Каждый кадр спавним всплески вдоль видимой части
// этих отрезков; каждый всплеск = вспышка удара + 2–4 капли, летящие вверх-вбок
// по параболе (гравитация). Мир→экран: sx = wx − cam.scrollX (zoom=1).

const CANVAS_W = 320
const CANVAS_H = 180
const DEPTH = 1000 // дождь поверх всего
const GROUND_DEPTH = 8 // брызги на полу: над тайлами (~4), под игроками (10)
// Брызги отскакивают вдоль угла дождя: штрих наклонён вверх-вправо (slope<0 →
// хвост уходит вправо), поэтому капли летят вверх-ВПРАВО. SPLASH_ANGLE ≈ |slope|:
// на каждый 1px вверх — столько px вправо.
const SPLASH_ANGLE = 0.42

// Палитра под Hollow Knight (мрачная топь / Mantis Village): десатурированный
// серый дождь — от почти белого до тёмно-серого, с лёгким холодным отливом.
// Рампа яркости: индекс 0 = ярче всего, последний = самый тёмный.
const COL_RAMP = [
	0xe6e9ee, // почти белый
	0xc6cbd2,
	0xa4abb5,
	0x848b96,
	0x646b77,
	0x49505b, // тёмно-серый
]
const COL_HEAD = 0xf2f5f9 // яркая голова ближних капель
const COL_SPECK = [0x9aa0aa, 0x7a818c, 0xc0c6ce] // тусклые серые крапины
const COL_SPLASH_LT = [0xe6e9ee, 0xc6cbd2] // светлые капли брызг (удар)
const COL_SPLASH_DK = [0x848b96, 0x646b77, 0x49505b] // тёмные капли брызг

// Слои дождя (далёкий → ближний). У каждого свои длина/скорость/наклон/яркость,
// внутри слоя ещё варьируются → капли разной длины и разных оттенков серого.
//   ci — диапазон индексов в COL_RAMP (ближе = ярче), a — базовая прозрачность.
// Длины ≈ ×1.5 от прежних. Наклон сохранён (ветер влево, как было).
const LAYERS = {
	far: {
		lenMin: 9,
		lenMax: 16,
		spMin: 200,
		spMax: 290,
		slMin: -0.4,
		slMax: -0.3,
		a: 0.32,
		head: false,
		ci: [3, 5],
	},
	mid: {
		lenMin: 13,
		lenMax: 22,
		spMin: 280,
		spMax: 380,
		slMin: -0.46,
		slMax: -0.34,
		a: 0.55,
		head: false,
		ci: [1, 4],
	},
	near: {
		lenMin: 17,
		lenMax: 28,
		spMin: 340,
		spMax: 480,
		slMin: -0.5,
		slMax: -0.38,
		a: 0.92,
		head: true,
		ci: [0, 2],
	},
}

// ⭐ ЕДИНАЯ РУЧКА силы подсветки дождя/брызг лампой. Масштабирует ВСЁ: и тонировку
// цвета к цвету лампы, и прибавку яркости. 1.0 = полная, 0.0 = ВЫКЛ (дождь как
// обычный, без оранжевого). Меняй ЭТО число. Если ставишь 0 и дождь всё равно
// оранжевый у лампы — значит модуль не перезагрузился (жёсткий релоад Ctrl+F5).
const GLOW_STRENGTH = 0.7

function pick(arr) {
	return arr[(Math.random() * arr.length) | 0]
}
function rand(min, max) {
	return min + Math.random() * (max - min)
}
// Линейная интерполяция двух 0xRRGGBB цветов (t: 0→a, 1→b).
function lerpColor(a, b, t) {
	const ar = (a >> 16) & 255,
		ag = (a >> 8) & 255,
		ab = a & 255
	const br = (b >> 16) & 255,
		bg = (b >> 8) & 255,
		bb = b & 255
	return (
		(((ar + (br - ar) * t) | 0) << 16) |
		(((ag + (bg - ag) * t) | 0) << 8) |
		((ab + (bb - ab) * t) | 0)
	)
}

export class RainEffect {
	// opts: { intensity:1.0, splashZones:[{x,y,w}], splashDensity:0.2 }
	//   intensity     — множитель плотности дождя; 0 отключает.
	//   splashZones   — мировые отрезки пола для брызг (из Tiled rainlayer).
	//   splashDensity — брызг в секунду на 1 мировой пиксель видимой зоны.
	constructor(scene, opts = {}) {
		this.scene = scene
		this.intensity = opts.intensity ?? 1.0
		this.zones = opts.splashZones || []
		this.splashDensity = opts.splashDensity ?? 0.6
		this.g = null
		this.drops = []
		this.specks = []
		this.splashes = []
		this.groundSplashes = []
		this._splashAcc = 0 // дробный аккумулятор спавна брызг
		// Источник света, который «ловит» дождь: {wx, wy} мировые, r — радиус в
		// canvas-пикселях, color 0xRRGGBB. Капли/крапины рядом подсвечиваются его
		// цветом и ярче. Обновляется снаружи каждый кадр (GameScene). null = нет.
		this.light = null
	}

	create() {
		if (this.intensity <= 0) return

		this.g = this.scene.add.graphics().setScrollFactor(0).setDepth(DEPTH)

		// Брызги на полу — отдельный graphics ниже игроков (но выше тайлов),
		// тоже в экранном пространстве; глубина сортирует его между ними.
		this.gGround = this.scene.add
			.graphics()
			.setScrollFactor(0)
			.setDepth(GROUND_DEPTH)

		// near = яркий ближний слой, far = тусклый дальний
		// Три слоя глубины: больше дальних/средних (создают «дымку» дождя),
		// меньше ярких ближних. Суммарно плотнее прежнего.
		const nearN = Math.round(40 * this.intensity)
		const midN = Math.round(54 * this.intensity)
		const farN = Math.round(48 * this.intensity)

		for (let i = 0; i < nearN; i++) this.drops.push(this._newDrop('near'))
		for (let i = 0; i < midN; i++) this.drops.push(this._newDrop('mid'))
		for (let i = 0; i < farN; i++) this.drops.push(this._newDrop('far'))

		// Стартовый разброс по всей высоте, чтобы экран был сразу заполнен.
		for (const d of this.drops) d.y = rand(-d.len, CANVAS_H)
	}

	_newDrop(layer) {
		const cfg = LAYERS[layer]
		// Наклон варьируется в рамках слоя (общий ветер влево).
		const slope = rand(cfg.slMin, cfg.slMax)
		// Запас по x: за время падения капля сместится на |slope|*H влево.
		const margin = Math.ceil(Math.abs(slope) * CANVAS_H) + 4
		// Случайный оттенок серого из диапазона слоя → капли разных цветов.
		const ci = rand(cfg.ci[0], cfg.ci[1] + 1) | 0
		return {
			layer,
			x: rand(0, CANVAS_W + margin),
			y: rand(-CANVAS_H, 0),
			len: Math.round(rand(cfg.lenMin, cfg.lenMax)),
			speed: rand(cfg.spMin, cfg.spMax), // canvas px/s
			slope,
			margin,
			color: COL_RAMP[Math.min(ci, COL_RAMP.length - 1)],
			baseA: cfg.a,
			head: cfg.head, // только ближний слой получает яркую голову
		}
	}

	_resetDrop(d) {
		d.y = rand(-d.len - 6, -d.len)
		d.x = rand(0, CANVAS_W + d.margin)
		// Фейковый всплеск у нижнего края — только если нет реальных зон пола,
		// иначе брызги идут из splashZones (метод _spawnGroundSplash).
		if (this.zones.length === 0 && d.head && Math.random() < 0.5) {
			this.splashes.push({
				x: Math.round(d.x + d.slope * d.len),
				y: Math.round(rand(168, 178)),
				life: rand(0.1, 0.2),
				max: 0.2,
			})
		}
	}

	// Один всплеск на полу в мировой точке (wx, wy): яркая вспышка удара +
	// 2–4 капли с начальной скоростью вверх-вбок, летящие по параболе.
	_spawnGroundSplash(wx, wy) {
		const n = 3 + ((Math.random() * 4) | 0) // 3..6 капель (больше, гуще)
		const drops = []
		for (let i = 0; i < n; i++) {
			const vy = -rand(24, 46) // px/s вверх — умеренный подброс
			drops.push({
				// Угол каждой капли свой (вокруг угла дождя, вправо-вверх) →
				// каждый брызг разлетается по-разному, паттерн не повторяется.
				vx: -vy * rand(SPLASH_ANGLE - 0.18, SPLASH_ANGLE + 0.22) + rand(-7, 9),
				vy,
				// Почти всегда тёмные капли — чтобы не цепляли взгляд.
				color: Math.random() < 0.12 ? pick(COL_SPLASH_LT) : pick(COL_SPLASH_DK),
			})
		}
		// Время жизни тоже варьируется — нет единого «такта» у всех брызг.
		const life = rand(0.36, 0.52)
		this.groundSplashes.push({ wx, wy, life, max: life, drops })
	}

	update(delta) {
		if (!this.g) return
		const dt = Math.min(delta / 1000, 0.05)
		const g = this.g
		const cam = this.scene.cameras.main
		g.clear()
		this.gGround?.clear()

		// ── Источник света в экранных координатах ─────────────────────────────
		// Капли и крапины рядом с лампой тонируются её цветом и ярче → «свет
		// динамично падает на дождь» + блики у источника. glowAt(px,py) → 0..1.
		const L = this.light
		const lx = L ? L.wx - cam.scrollX : 0
		const ly = L ? L.wy - cam.scrollY : 0
		const lr = L ? L.r : 0
		const lcol = L ? L.color : 0xffffff
		const glowAt = (px, py) => {
			if (!L) return 0
			const dx = px - lx,
				dy = py - ly
			const d = Math.sqrt(dx * dx + dy * dy)
			if (d >= lr) return 0
			const t = 1 - d / lr
			// smoothstep (плавный заход/спад) × единый множитель силы подсветки.
			return t * t * (3 - 2 * t) * GLOW_STRENGTH
		}

		// ── Штрихи дождя ──────────────────────────────────────────────────────
		for (const d of this.drops) {
			d.y += d.speed * dt
			d.x += d.slope * d.speed * dt
			if (d.y - d.len > CANVAS_H) this._resetDrop(d)

			const hx = Math.round(d.x)
			const hy = Math.round(d.y)
			// Подсветка каплей у лампы — считаем раз по голове капли.
			const gf = glowAt(hx, hy)
			const bodyCol = gf > 0 ? lerpColor(d.color, lcol, gf * 0.85) : d.color
			const headCol = gf > 0 ? lerpColor(COL_HEAD, lcol, gf * 0.6) : COL_HEAD
			// От головы (i=0, ярко) к хвосту (i=len, тускло) вверх-вправо.
			for (let i = 0; i <= d.len; i++) {
				const py = hy - i
				if (py < 0 || py > CANVAS_H) continue
				const px = Math.round(d.x - d.slope * i)
				const t = i / d.len // 0 голова .. 1 хвост
				// Голова яркая, хвост угасает; масштаб от базовой прозрачности слоя.
				const a = Math.min(1, d.baseA * (1 - t * 0.85) + gf * 0.2)
				if (a <= 0.03) continue
				const col = d.head && i <= 1 ? headCol : bodyCol
				g.fillStyle(col, a)
				g.fillRect(px, py, 1, 1)
			}
		}

		// ── Всплески у поверхности ────────────────────────────────────────────
		for (let k = this.splashes.length - 1; k >= 0; k--) {
			const sp = this.splashes[k]
			sp.life -= dt
			if (sp.life <= 0) {
				this.splashes.splice(k, 1)
				continue
			}
			const a = (sp.life / sp.max) * 0.8
			g.fillStyle(COL_HEAD, a)
			g.fillRect(sp.x, sp.y, 1, 1)
			g.fillStyle(pick(COL_SPLASH_LT), a * 0.7)
			g.fillRect(sp.x - 1, sp.y - 1, 1, 1)
			g.fillRect(sp.x + 1, sp.y - 1, 1, 1)
		}

		// ── Брызги на полу (мировые зоны из Tiled) ────────────────────────────
		if (this.zones.length) {
			// Видимые отрезки зон в экранном пространстве (zoom=1).
			const left = cam.scrollX
			const right = left + CANVAS_W
			const segs = []
			let visW = 0
			for (const z of this.zones) {
				const a = Math.max(z.x, left)
				const b = Math.min(z.x + z.w, right)
				const sy = z.y - cam.scrollY
				if (b > a && sy >= -4 && sy <= CANVAS_H + 4) {
					segs.push({ a, b, y: z.y })
					visW += b - a
				}
			}
			// Спавн: visW * плотность * интенсивность капель/сек.
			this._splashAcc += visW * this.splashDensity * this.intensity * dt
			while (this._splashAcc >= 1 && segs.length) {
				this._splashAcc -= 1
				// Выбор точки равномерно по суммарной видимой длине.
				let r = Math.random() * visW
				let seg = segs[0]
				for (const s of segs) {
					const w = s.b - s.a
					if (r < w) {
						seg = s
						break
					}
					r -= w
				}
				this._spawnGroundSplash(rand(seg.a, seg.b), seg.y)
			}
		}

		// Рендер активных брызг в gGround (под игроками, над тайлами).
		const gg = this.gGround
		if (gg) {
			const GRAV = 110 // px/s² — низкая: медленный, низкий, растянутый разлёт
			for (let k = this.groundSplashes.length - 1; k >= 0; k--) {
				const s = this.groundSplashes[k]
				s.life -= dt
				if (s.life <= 0) {
					this.groundSplashes.splice(k, 1)
					continue
				}
				const t = s.life / s.max // 1 → 0
				const age = s.max - s.life
				const sx = Math.round(s.wx - cam.scrollX)
				const sy = Math.round(s.wy - cam.scrollY)
				if (sx < -2 || sx > CANVAS_W + 2 || sy < -2 || sy > CANVAS_H + 2)
					continue

				// Подсветка брызга лампой — тем же радиусом/силой, что и дождь.
				const gf = glowAt(sx, sy)

				// Тусклая «корона» удара в первой трети жизни (тёмная, без яркой
				// вспышки — чтобы не цеплять взгляд). У лампы тонируется её цветом.
				if (t > 0.66) {
					let cc = pick(COL_SPLASH_DK)
					let ca = t * 0.3
					if (gf > 0) {
						cc = lerpColor(cc, lcol, gf * 0.9)
						ca = Math.min(1, ca + gf * 0.2)
					}
					gg.fillStyle(cc, ca)
					gg.fillRect(sx, sy - 1, 1, 1)
					gg.fillRect(sx + 1, sy, 1, 1)
				}

				// Капли: позиция аналитически из age (вверх+ветер → парабола вниз).
				// Заметно тусклее дождя — брызги читаются как фоновые.
				const a = Math.min(1, t * 1.3) * 0.38
				for (const d of s.drops) {
					const py = Math.round(sy + d.vy * age + 0.5 * GRAV * age * age)
					if (py > sy) continue // не рисуем ниже пола
					const px = Math.round(sx + d.vx * age)
					if (px < 0 || px > CANVAS_W || py < 0 || py > CANVAS_H) continue
					const col = gf > 0 ? lerpColor(d.color, lcol, gf * 0.85) : d.color
					const da = gf > 0 ? Math.min(1, a + gf * 0.2) : a
					gg.fillStyle(col, da)
					gg.fillRect(px, py, 1, 1)
				}
			}
		}
	}

	destroy() {
		this.g?.destroy()
		this.g = null
		this.gGround?.destroy()
		this.gGround = null
		this.drops.length = 0
		this.specks.length = 0
		this.splashes.length = 0
		this.groundSplashes.length = 0
	}
}
