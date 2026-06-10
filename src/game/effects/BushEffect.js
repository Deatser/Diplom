import Phaser from 'phaser'

// Процедурный сухой куст/ветка (без ассетов) — рисуется в Graphics в МИРОВЫХ
// координатах от точки объекта type:"kust" в Tiled. Ствол фрактально ветвится
// (рекурсия с детерминированным seed-RNG → структура стабильна между кадрами),
// а ветки качаются от «ветра»: чем выше/дальше к кончику, тем сильнее изгиб
// (накапливаем sway вниз по рекурсии). КЛЮЧ: координаты снапятся к сетке холста
// (1px = «большой пиксель» ≈ 8 реальных при апскейле) → движение чёткими
// арт-пикселями, как у проводов (WireEffect). Тёмный силуэт по умолчанию.
const GRID = 1

// Детерминированный PRNG (mulberry32) — один и тот же seed даёт ту же структуру
// каждый кадр, поэтому куст не «мерцает», а только качается.
function mulberry32(a) {
	return function () {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

export class BushEffect {
	// bushes: [{ x,y, seed, height, thickness, sway, speed, levels, color, depth, phase }]
	constructor(scene, bushes) {
		this.scene = scene
		this.bushes = bushes
		this.g = null
		this.t = 0
	}

	create() {
		const depth = this.bushes[0]?.depth ?? 950
		this.g = this.scene.add.graphics().setDepth(depth)
		this._draw()
	}

	update(delta) {
		if (!this.g) return
		this.t += delta / 1000
		this._draw()
	}

	_draw() {
		const g = this.g
		g.clear()
		for (const b of this.bushes) {
			g.fillStyle(b.color ?? 0x0a0d18, 1)
			const rng = mulberry32(b.seed ?? 7)
			// глобальный «ветер» этого куста (радианы): медленное качание + порыв
			const wind =
				(b.sway ?? 0.08) * Math.sin(this.t * (b.speed ?? 1.0) + (b.phase ?? 0))
			const levels = b.levels ?? 5
			// КУСТ, не дерево: ствол короткий (доля от height) → ветки фанятся низко
			// у самого основания, а не на верхушке длинного голого шеста.
			const trunk = (b.height ?? 36) * 0.45
			// ствол растёт вверх (angle = -PI/2)
			this._branch(
				g,
				b,
				rng,
				b.x,
				b.y,
				-Math.PI / 2,
				trunk,
				b.thickness ?? 3,
				levels,
				wind,
				0,
			)
		}
	}

	// Рекурсивная ветка. accumSway — накопленный изгиб от ветра (растёт к кончикам).
	_branch(g, b, rng, x, y, angle, len, thick, lvl, wind, accumSway) {
		// ветер добавляет изгиб на каждом уровне → кончики качаются сильнее основания
		const bend = accumSway + wind
		const a = angle + bend
		const ex = x + Math.cos(a) * len
		const ey = y + Math.sin(a) * len
		const terminal = lvl <= 1 || len < 3
		// сужение: от thick у основания к 1px на кончике терминальной ветки,
		// иначе — к толщине, с которой стартуют дети (стык без ступеньки).
		const thickEnd = terminal ? 1 : Math.max(1, thick - 1)
		this._segment(g, x, y, ex, ey, thick, thickEnd)
		if (terminal) return
		// у куста веток больше и разлёт шире → пышная крона, а не тонкое дерево
		const n = 2 + (rng() < 0.7 ? 1 : 0) + (rng() < 0.3 ? 1 : 0) // 2–4
		for (let i = 0; i < n; i++) {
			const spread = (rng() - 0.5) * 1.5 // ± угол разлёта
			const childLen = len * (0.68 + rng() * 0.2)
			this._branch(
				g,
				b,
				rng,
				ex,
				ey,
				a + spread,
				childLen,
				thickEnd, // дети продолжают сужение от точки стыка
				lvl - 1,
				wind,
				bend, // дети наследуют изгиб родителя → накопление к кончику
			)
		}
	}

	// Пиксельный отрезок с сужением: толщина линейно идёт от thick0 (основание) к
	// thick1 (конец). Квадрат центрируем на линии → сужение симметричное, кончик
	// получается острым. Снап к GRID, мостим углы, чтобы линия была сплошной.
	_segment(g, x0, y0, x1, y1, thick0, thick1) {
		const dx = x1 - x0
		const dy = y1 - y0
		const span = Math.max(Math.abs(dx), Math.abs(dy), 1)
		const steps = Math.max(1, Math.round(span / GRID))
		let pX = null
		let pY = null
		for (let i = 0; i <= steps; i++) {
			const u = i / steps
			const t = Math.max(1, Math.round(thick0 + (thick1 - thick0) * u))
			const off = Math.floor(t / 2) * GRID // центрируем квадрат на линии
			const sx = Math.floor((x0 + dx * u) / GRID) * GRID
			const sy = Math.floor((y0 + dy * u) / GRID) * GRID
			// диагональный шаг → мостим угол, чтобы линия была сплошной
			if (pX !== null && sx !== pX && sy !== pY) {
				g.fillRect(pX - off, sy - off, GRID * t, GRID * t)
			}
			g.fillRect(sx - off, sy - off, GRID * t, GRID * t)
			pX = sx
			pY = sy
		}
	}

	destroy() {
		this.g?.destroy()
		this.g = null
	}
}
