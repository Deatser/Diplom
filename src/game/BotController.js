// BotController — простой тестовый автобот. Ведёт игрока (ОРАНЖЕВЫЙ/гость) по точкам
// слоя "bot" (type="bot", свойство id=1..N по порядку), ждёт ~3с на каждой, затем
// идёт к следующей и т.д. Точка с wait=0 — сквозная: пробегается без остановки,
// с прыжком в момент пересечения. Точка с dash=true — тоже сквозная: в момент
// касания бот сразу жмёт дэш по ходу движения и бежит дальше не останавливаясь.
//
// Идея: бот не дёргает физику напрямую, а СИНТЕЗИРУЕТ «нажатия клавиш» (тот же интерфейс,
// что читает Player.updateLocal) и прогоняет их через обычный апдейт игрока. Поэтому
// ускорение/торможение/анимация/прыжок — ровно как у живого игрока. Сверху накладываем
// человеческие неидеальности: задержку реакции, лёгкие паузы-заминки, разброс таймингов,
// варьируемую высоту прыжка — чтобы движение не выглядело идеально роботизированным.

const rand = (a, b) => a + Math.random() * (b - a)

export class BotController {
	constructor(player, waypoints, opts = {}) {
		this.player = player
		this.points = waypoints.slice() // [{x,y}, …] в порядке bot1..botN
		// Колбэк «клика ЛКМ» (выдаёт GameScene) — активирует интерактив рядом с ботом
		this.onClick = opts.onClick || null
		this.clickAt = 0 // когда «кликнуть» на точке с click=true (0 = не запланирован)
		this.idx = 0
		// Виртуальные «клавиши» — те же поля, что читает Player.updateLocal.
		// dash._justDown нужен, т.к. dash проверяется через Phaser JustDown(keys.dash).
		this.keys = {
			left: { isDown: false },
			right: { isDown: false },
			jump: { isDown: false },
			jumpW: { isDown: false },
			down: { isDown: false },
			dash: { isDown: false, _justDown: false },
		}
		this.target = this.points[0] || { x: player.x, y: player.y }
		this.state = 'react' // 'react' → 'move' → 'wait' → 'react' → …
		this.timer = rand(300, 700) // лёгкая пауза перед самым первым шагом
		this.stopThr = rand(3, 7) // у какого порога по X считаем «дошёл» (чуть разный)
		this.hesitateAt = rand(1200, 2600) // через сколько мс возможна заминка на ходу
		this.pauseTimer = 0 // активная микропауза-заминка
		this.jumpCdUntil = 0 // кулдаун между прыжками (мс игрового времени)
		this.jumpHoldUntil = 0 // до какого времени держим «прыжок» (variable height)
		this.forceDir = 0 // направление, удерживаемое после дэш-точки (-1/0/1)
		this.forceDirUntil = 0 // до какого времени держим forceDir
	}

	_release() {
		this.keys.left.isDown = false
		this.keys.right.isDown = false
	}

	_advance() {
		if (this.points.length) this.idx = (this.idx + 1) % this.points.length
		this.target = this.points[this.idx] || this.target
		this.stopThr = rand(3, 7)
		this._lastDx = null // сброс детектора «пробежал мимо» для новой цели
	}

	// delta — мс с прошлого кадра; now — игровое время (мс). Возвращает виртуальные
	// клавиши, которые сцена передаёт в this.localPlayer.updateLocal(keys, delta, now).
	update(delta, now) {
		const p = this.player
		const body = p.body
		const onGround = !!body?.blocked.down
		const dx = this.target.x - p.x
		const dy = this.target.y - p.y
		const adx = Math.abs(dx)
		const dir = Math.sign(dx)

		// Отпускаем «прыжок» по таймеру удержания → высота прыжка получается варьируемой.
		if (this.keys.jump.isDown && now >= this.jumpHoldUntil)
			this.keys.jump.isDown = false

		// Дэш одноразовый: Player читает его через Phaser JustDown(keys.dash) и сам
		// сбрасывает _justDown, но на всякий случай чистим флаг в начале кадра.
		this.keys.dash._justDown = false

		// ── Пауза перед движением (реакция/«собрался идти») ──
		if (this.state === 'react') {
			this._release()
			this.timer -= delta
			if (this.timer <= 0) {
				this.state = 'move'
				this.hesitateAt = rand(1200, 2600)
			}
			return this.keys
		}

		// ── Ожидание на точке (~3 секунды) ──
		if (this.state === 'wait') {
			this._release()
			// Точка с click=true: «нажать ЛКМ» с человеческой задержкой после прихода
			if (this.clickAt && now >= this.clickAt) {
				this.clickAt = 0
				this.onClick?.()
			}
			this.timer -= delta
			if (this.timer <= 0) {
				this._advance()
				this.state = 'react'
				this.timer = rand(150, 420) // человеческая реакция перед новым рывком
			}
			return this.keys
		}

		// ── state === 'move' ──
		// Сквозные точки — НЕ останавливаемся, пробегаем/пролетаем на полной скорости:
		//   wait=0    → прыжок в момент пересечения, если следующая точка выше
		//               (разгон: bot3 → разбег → прыжок ровно на bot4 → долёт до bot5)
		//   dash=true → в момент касания сразу дэш по ходу движения, бежим дальше
		const passThrough = this.target.wait === 0 || this.target.dash

		// Микропауза-заминка: человек иногда «подвисает» на ходу на доли секунды.
		// На сквозных точках и в воздухе заминок нет — иначе сорвём разбег/полёт.
		if (this.pauseTimer > 0) {
			this.pauseTimer -= delta
			this._release()
			return this.keys
		}
		this.hesitateAt -= delta
		if (this.hesitateAt <= 0) {
			this.hesitateAt = rand(1400, 3000)
			if (!passThrough && onGround && Math.random() < 0.45) {
				this.pauseTimer = rand(90, 240)
				this._release()
				return this.keys
			}
		}

		if (passThrough) {
			// Пересечение по X: либо совсем рядом, либо проскочили (dx сменил знак).
			const crossed =
				adx <= 4 ||
				(this._lastDx != null && Math.sign(this._lastDx) !== Math.sign(dx))
			this._lastDx = dx
			if (crossed) {
				if (this.target.dash) {
					// Дэш-точка: рывок строго по ходу движения. Направление держим
					// зажатым на время дэша (~DASH_SECS), чтобы Player не развернул
					// flipX к следующей цели до старта рывка.
					const moveDir = Math.sign(body.velocity.x) || dir || 1
					this.keys.dash._justDown = true
					this.forceDir = moveDir
					this.forceDirUntil = now + 220
					this._advance()
					this.keys.left.isDown = moveDir < 0
					this.keys.right.isDown = moveDir > 0
					return this.keys
				}
				const next = this.points[(this.idx + 1) % this.points.length]
				// Высоту сравниваем точка-к-точке (а не к центру игрока): у точек один
				// конвент размещения, а центр спрайта смещён и даёт ложные ~±20px.
				const needJump =
					this.target.jump || (next && next.y - this.target.y < -18)
				if (needJump && onGround && now >= this.jumpCdUntil) {
					this.keys.jump.isDown = true
					this.jumpHoldUntil = now + rand(210, 250) // полная высота прыжка
					this.jumpCdUntil = now + 500
				}
				this._advance()
				// Тут же бежим к новой цели — без отпускания клавиш, скорость не теряем.
				const ndir = Math.sign(this.target.x - p.x)
				this.keys.left.isDown = ndir < 0
				this.keys.right.isDown = ndir > 0
				return this.keys
			}
		}

		// Прибытие: близко по X, стоим на земле и примерно на высоте точки.
		// Сквозные точки сюда не попадают — их обрабатывает блок passThrough выше.
		// «Спокойная» скорость обязательна: на пролёте дэшем (380) или скольжении
		// после него (180) точка НЕ засчитывается — иначе бот «ворует» её на лету
		// и уходит дальше вместо того, чтобы вернуться (id9 → перелёт id10).
		const calm =
			!p._dashActive &&
			now >= this.forceDirUntil &&
			Math.abs(body.velocity.x) <= 130 // MAX_RUN=120 + запас
		if (!passThrough && calm && adx <= this.stopThr && onGround && Math.abs(dy) < 28) {
			this._release()
			// Необязательный «прыжок на точке» (свойство jump в Tiled) — один раз.
			if (this.target.jump && now >= this.jumpCdUntil) {
				this.keys.jump.isDown = true
				this.jumpHoldUntil = now + rand(160, 240)
				this.jumpCdUntil = now + 600
			}
			// Куда смотреть стоя (свойство face). updateLocal не трогает flip без движения.
			if (this.target.face === 'left') p.setFlipX(true)
			else if (this.target.face === 'right') p.setFlipX(false)
			// Точка с click=true → запланировать «клик ЛКМ» через 250–600мс стояния
			if (this.target.click && this.onClick) this.clickAt = now + rand(250, 600)
			this.state = 'wait'
			// Время ожидания: из свойства wait (секунды) либо ~3 c по умолчанию. Лёгкий
			// разброс ±120мс для человечности, но не уходим в минус.
			const w = this.target.wait
			this.timer =
				w != null && w >= 0
					? Math.max(0, w * 1000 + rand(-120, 120))
					: rand(2700, 3300)
			return this.keys
		}

		// Идём к цели по горизонтали.
		this.keys.left.isDown = dir < 0
		this.keys.right.isDown = dir > 0

		// После дэш-точки держим направление рывка, пока он не закончится, —
		// иначе бот развернётся к следующей цели и дэш уйдёт не туда.
		if (now < this.forceDirUntil) {
			this.keys.left.isDown = this.forceDir < 0
			this.keys.right.isDown = this.forceDir > 0
			return this.keys
		}

		// Прыжок: цель заметно выше и мы уже близко по X (запрыгнуть на платформу),
		// либо упёрлись в стену по ходу движения (перепрыгнуть препятствие).
		const blocked =
			(dir > 0 && body.blocked.right) || (dir < 0 && body.blocked.left)
		const needUp = dy < -18
		if (onGround && now >= this.jumpCdUntil && ((needUp && adx < 64) || blocked)) {
			this.keys.jump.isDown = true
			// VAR_JUMP_TIME=150мс → держим чуть дольше для уверенной высоты, с разбросом.
			this.jumpHoldUntil = now + rand(160, 240)
			this.jumpCdUntil = now + rand(420, 680)
			// Цель выше и ещё далеко по X → держим прыжок на полную высоту.
			if (needUp && adx > 46) this.jumpHoldUntil = now + rand(210, 250)
		}

		return this.keys
	}
}
