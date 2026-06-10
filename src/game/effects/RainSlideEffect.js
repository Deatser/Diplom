import Phaser from 'phaser'

// ── Стекающие капли по стене (rainslide) ─────────────────────────────────────
//
// Процедурный эффект без ассетов. В отличие от основного дождя (RainEffect,
// экранное пространство), эти капли «приклеены» к поверхности стены — рисуются
// в МИРОВЫХ координатах (scrollFactor 1) внутри прямоугольников объектов
// type:"rainslide" из Tiled.
//
// Поведение каждой капли: короткий вертикальный штрих, стекающий ВНИЗ на
// небольшое расстояние, с плавным появлением и затуханием по жизни. Дойдя до
// конца пути — каплю перерождаем в СЛУЧАЙНОЙ точке прямоугольника (не только
// сверху!). За счёт случайного спавна по всей площади и fade-in/out выходит вид
// «капля появилась → стекла чуть → исчезла → ниже снова появилась → …» по всей
// стене одновременно.
//
// Цвет и прозрачность — как у основного дождя (та же серая рампа Hollow Knight).
// Координаты снапятся к целому мировому пикселю → чёткие арт-пиксели при апскейле.

const GRID = 1

// Палитра — копия рампы основного дождя (RainEffect.COL_RAMP): от почти белого
// к тёмно-серому с холодным отливом. Прозрачность тоже в духе дождя.
const COL_RAMP = [
	0xe6e9ee, // почти белый
	0xc6cbd2,
	0xa4abb5,
	0x848b96,
	0x646b77,
	0x49505b, // тёмно-серый
]
const COL_HEAD = 0xf2f5f9 // яркая «голова» капли (передняя точка)

// Плотность капель: штук на 1 мировой пиксель площади прямоугольника.
const DENSITY = 0.014
const MAX_DROPS = 600

// Сила подсветки лампой (как RainEffect.GLOW_STRENGTH): тонировка к цвету лампы
// + прибавка яркости вблизи источника.
const GLOW_STRENGTH = 1.1

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

export class RainSlideEffect {
	// zones: [{ x, y, w, h, depth }] — мировые прямоугольники стен (type:"rainslide").
	constructor(scene, zones) {
		this.scene = scene
		this.zones = zones || []
		this.g = null
		this.drops = []
		// Источники света ламп: массив { wx, wy, r, color, intensity } в МИРОВЫХ
		// координатах. Капля у ближайшей лампы тонируется её цветом и ярче.
		// Ставится снаружи (GameScene), как у RainEffect. [] = нет подсветки.
		this.lights = []
		this._glowCol = 0xffffff
	}

	create() {
		if (!this.zones.length) return
		// depth с первого объекта (опц. свойство Tiled). По умолчанию 5: перед
		// тайлами (~4), за игроком (10) — капли лежат на поверхности стены-фона.
		const depth = this.zones[0]?.depth ?? 5
		this.g = this.scene.add.graphics().setDepth(depth) // мир (scrollFactor 1)

		// Кумулятивные площади → спавним капли пропорционально размеру стены.
		let total = 0
		this._cum = this.zones.map(z => (total += z.w * z.h))
		this._totalArea = total
		const count = Math.min(MAX_DROPS, Math.round(total * DENSITY))
		for (let i = 0; i < count; i++) {
			const d = {}
			this._spawn(d)
			// стартовый разброс по «возрасту» → не вспыхивают все разом
			d.dist = rand(0, d.maxDist)
			this.drops.push(d)
		}
	}

	// Случайная стена по площади (большие стены получают больше капель).
	_pickZone() {
		const r = Math.random() * this._totalArea
		for (let i = 0; i < this._cum.length; i++) {
			if (r < this._cum[i]) return this.zones[i]
		}
		return this.zones[this.zones.length - 1]
	}

	// (Пере)рождение капли в СЛУЧАЙНОЙ точке прямоугольника — по всей площади.
	_spawn(d) {
		const z = this._pickZone()
		d.zone = z
		d.x = Math.floor(z.x + Math.random() * z.w)
		d.y = Math.floor(z.y + Math.random() * z.h) // где угодно по высоте, не только сверху
		d.len = Math.round(rand(2, 9)) // от точки до короткого штриха
		d.speed = rand(11, 32) // px/s — медленное стекание (в 1.5 раза медленнее)
		d.maxDist = rand(6, 22) // короткий путь до исчезновения
		d.dist = 0
		const ci = rand(1, 5) | 0
		d.color = COL_RAMP[ci]
		d.baseA = rand(0.1, 0.25) // очень тускло — почти незаметно
		d.head = Math.random() < 0.5 // у части — яркая голова
	}

	update(delta) {
		if (!this.g) return
		const dt = Math.min(delta / 1000, 0.05)
		const g = this.g
		g.clear()
		// Подсветка ближайшей лампой из массива (мировые px; при zoom=1 = canvas px,
		// как радиус лампы). Цвет доминирующей лампы → this._glowCol для тонировки.
		const lights = this.lights || []
		const glowAt = (wx, wy) => {
			let best = 0
			let col = 0xffffff
			for (const L of lights) {
				if (!L) continue
				const dx = wx - L.wx
				const dy = wy - L.wy
				const dd = Math.sqrt(dx * dx + dy * dy)
				if (dd >= L.r) continue
				const tt = 1 - dd / L.r
				const gg = tt * tt * (3 - 2 * tt) * GLOW_STRENGTH * (L.intensity ?? 1)
				if (gg > best) {
					best = gg
					col = L.color
				}
			}
			this._glowCol = col
			return best
		}
		for (const d of this.drops) {
			d.y += d.speed * dt
			d.dist += d.speed * dt
			if (d.dist >= d.maxDist) {
				this._spawn(d)
				continue
			}
			// Жизненная прозрачность: быстрый fade-in, держим, плавный fade-out →
			// «появилась → стекла → исчезла».
			const p = d.dist / d.maxDist // 0..1
			const lifeA = p < 0.2 ? p / 0.2 : p > 0.6 ? (1 - p) / 0.4 : 1
			const a = d.baseA * lifeA
			if (a <= 0.03) continue

			const z = d.zone
			const top = z.y
			const bot = z.y + z.h
			const x = Math.floor(d.x / GRID) * GRID
			const hy = Math.floor(d.y / GRID) * GRID
			// Подсветка считается раз по голове капли — как у дождя.
			const gf = glowAt(d.x, d.y)
			const lcol = this._glowCol // цвет ближайшей лампы (set в glowAt)
			// Затухание у краёв прямоугольника: чем ближе к краю, тем прозрачнее, у
			// самой кромки — ноль. По X (фиксирован у капли) считаем раз, по Y — на
			// каждый пиксель штриха. margin — ширина зоны растушёвки.
			// marginY маленький: иначе широкая «мёртвая» полоса по краям делает так,
			// что все капли проявляются на одной высоте. Узкая кромка → гаснут только
			// у самого верх/низ края, а появляются на РАЗНЫХ высотах (через свой fade).
			const marginX = Math.min(14, z.w * 0.4)
			const marginY = Math.min(3, z.h * 0.12)
			const dxe = Math.min(d.x - z.x, z.x + z.w - d.x)
			const efx = Math.max(0, Math.min(1, dxe / marginX))
			// Голова (i=0) у нижнего конца штриха (ведущая кромка), хвост уходит вверх.
			for (let i = 0; i <= d.len; i++) {
				const py = hy - i
				if (py < top || py > bot) continue // не вылезаем за стену
				const dye = Math.min(py - top, bot - py)
				const ef = efx * Math.max(0, Math.min(1, dye / marginY)) // 0 у края .. 1 в центре
				const t = i / d.len // 0 голова .. 1 хвост
				let pa = a * (1 - t * 0.7) * ef
				if (pa <= 0.03 && (gf <= 0 || ef <= 0)) continue
				const base = d.head && i === 0 ? COL_HEAD : d.color
				// Рядом с лампой: тонируем к цвету лампы и прибавляем яркость (тоже
				// гаснет у краёв через ef → кромка исчезает даже под лампой).
				const col = gf > 0 ? lerpColor(base, lcol, gf * 0.85) : base
				if (gf > 0) pa = Math.min(1, pa + gf * 0.2 * ef)
				if (pa <= 0.03) continue
				g.fillStyle(col, pa)
				g.fillRect(x, py, GRID, GRID)
			}
		}
	}

	destroy() {
		this.g?.destroy()
		this.g = null
		this.drops.length = 0
	}
}
