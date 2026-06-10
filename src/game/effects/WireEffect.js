import Phaser from 'phaser'

// Процедурный болтающийся провод (без ассетов). Рисуется в Graphics в МИРОВЫХ
// координатах — концы задаются двумя объектами type:"wire" в Tiled (пара по
// свойству group). Провод провисает параболой-катенарией между точками, а
// глубина провисания плавно качается синусом. КЛЮЧ: координаты снапятся к сетке
// холста (1px = один «большой пиксель» = ~8 реальных при апскейле) → движение
// вниз-вверх идёт чёткими арт-пикселями. Чёрный силуэт по умолчанию.
//
// Глубина задаётся ПОПРОВОДНО (w.depth): провода группируются по глубине, на
// каждую глубину — отдельный Graphics. Так один провод можно увести за тайлы
// (например, за слой back), пока остальные висят спереди (depth 900).
const GRID = 1

export class WireEffect {
	// wires: [{ax,ay,bx,by, sag, amp, speed, phase, color, depth, thickness}]
	constructor(scene, wires) {
		this.scene = scene
		this.wires = wires
		this.layers = [] // [{ g, wires }] — один Graphics на каждую глубину
		this.t = 0
		// Текущая верхняя кромка проводов как зоны брызг {x,y,w} (мировые), на
		// которые дождь спавнит всплески. Перестраивается каждый кадр в _draw().
		this.splashZones = []
	}

	create() {
		// Группируем провода по глубине → один Graphics на глубину.
		// 900 по умолчанию: спереди (выше игроков 10, ниже дождя 1000).
		const byDepth = new Map()
		for (const w of this.wires) {
			const d = w.depth ?? 900
			if (!byDepth.has(d)) byDepth.set(d, [])
			byDepth.get(d).push(w)
		}
		for (const [depth, wires] of byDepth) {
			const g = this.scene.add.graphics().setDepth(depth)
			this.layers.push({ g, wires })
		}
		this._draw()
	}

	update(delta) {
		if (!this.layers.length) return
		this.t += delta / 1000
		this._draw()
	}

	_draw() {
		this.splashZones.length = 0 // перестраиваем кромку каждый кадр
		for (const layer of this.layers) {
			layer.g.clear()
			for (const w of layer.wires) this._drawWire(layer.g, w)
		}
	}

	_drawWire(g, w) {
		// База провисания + качание, снап к сетке → ступенчатое движение
		const raw = w.sag + w.amp * Math.sin(this.t * w.speed + (w.phase ?? 0))
		const sag = Math.round(raw / GRID) * GRID
		const thick = w.thickness ?? GRID
		g.fillStyle(w.color ?? 0x000000, 1)

		const span = Math.abs(w.bx - w.ax)
		const steps = Math.max(2, Math.round(span / GRID))
		let prevSy = null
		for (let i = 0; i <= steps; i++) {
			const u = i / steps
			const x = w.ax + (w.bx - w.ax) * u
			// парабола 4u(1-u): провис максимум в середине, 0 на концах
			const y = w.ay + (w.by - w.ay) * u + sag * 4 * u * (1 - u)
			const sx = Math.floor(x / GRID) * GRID
			const sy = Math.floor(y / GRID) * GRID
			// заполняем вертикальный разрыв с предыдущим столбцом → нет дыр на склоне
			if (prevSy !== null && Math.abs(sy - prevSy) > GRID) {
				const lo = Math.min(sy, prevSy)
				const hi = Math.max(sy, prevSy)
				g.fillRect(sx, lo, GRID, hi - lo + thick)
			} else {
				g.fillRect(sx, sy, GRID, thick)
			}
			// верхняя кромка провода → зона брызг (дождь бьёт по верху)
			this.splashZones.push({ x: sx, y: sy, w: GRID })
			prevSy = sy
		}
	}

	destroy() {
		for (const layer of this.layers) layer.g?.destroy()
		this.layers.length = 0
	}
}
