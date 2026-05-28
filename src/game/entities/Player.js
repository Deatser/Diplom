import Phaser from 'phaser'

// ── Hollow Knight–inspired physics constants ─────────────────────────────────
// HK feel: высокий прыжок (~4-5 высот игрока), снэппи дэш, быстрый разгон.
// Gravity = 900 задаётся в GameManager.js arcade config.

const MAX_RUN = 120 // px/s — чуть быстрее Celeste
const RUN_ACCEL = 1500 // px/s² — снэппи разгон
const RUN_REDUCE = 500 // px/s²
const AIR_MULT = 0.65

const JUMP_VEL = -200 // px/s — apex ≈ 52px ≈ 4.7 высоты игрока
const JUMP_HBOOST = 40 // px/s горизонтальный буст при прыжке
const VAR_JUMP_TIME = 0.15 // s — HK чуть короче окно чем Celeste
const HALF_GRAV_THRESHOLD = 40 // px/s — плавный apex
const JUMP_GRACE = 0.1 // s — coyote time
const MAX_FALL = 200 // px/s
const FAST_MAX_FALL = 280 // px/s при зажатом вниз

const DASH_SPEED = 380 // px/s — быстрый резкий дэш
const END_DASH_SPEED = 180 // px/s скорость после дэша
const DASH_SECS = 0.12 // s — короткий и снэппи
const DASH_CD = 0.6 // s

// Спрайт рыцаря: кадр 64×64 в листе, отображаем 48×48 на холсте 320×180
// Сам рыцарь занимает ~30% кадра → ~14-16 canvas-px видимого персонажа
// Хитбокс 12×22 — центрирован горизонтально, прижат к низу
const HB_W = 12,
	HB_H = 22
const CHAR_CFG = {
	blue: { sprW: 48, sprH: 48 },
	orange: { sprW: 48, sprH: 48 },
}

// ── Approach helper ─────────────────────────────────────────────────────────
// Moves `val` toward `target` by at most `maxStep` — clamps without overshooting.
// Mirrors Celeste's Calc.Approach() for framerate-independent acceleration.
function approach(val, target, maxStep) {
	if (val < target) return Math.min(val + maxStep, target)
	return Math.max(val - maxStep, target)
}

export class Player extends Phaser.Physics.Arcade.Sprite {
	constructor(scene, x, y, textureKey, isLocal) {
		super(scene, x, y, textureKey)
		scene.add.existing(this)
		scene.physics.add.existing(this)

		this.isLocal = isLocal
		this.setDepth(10)

		// Определяем персонажа по ключу текстуры ('blue-idle-1' → 'blue', 'orange-…' → 'orange')
		this._charPrefix = textureKey.startsWith('blue') ? 'blue' : 'orange'
		const { sprW, sprH } = CHAR_CFG[this._charPrefix]
		this.setDisplaySize(sprW, sprH)
		// Хитбокс 8×11, центрирован горизонтально, прижат к низу спрайта
		this.body.setSize(HB_W, HB_H).setOffset((sprW - HB_W) / 2, sprH - HB_H)
		this.setCollideWorldBounds(true)

		// Ability state
		this.unlockedAbilities = new Set()
		this._prevJump = false
		this._dashEndMs = 0
		this._dashCdEndMs = 0
		this._dashActive = false
		this._usedAirDash = false
		this._usedDblJump = false
		this._facingRight = true
		this._varJumpTimer = 0
		this._jumpGraceTimer = 0
		this._animState = 'idle' // 'idle' | 'run' | 'attack'
		this._netDashActive = false // актуально только для remote player

		// Запускаем idle сразу — анимации созданы в PreloadScene до старта GameScene
		this.play(this._charPrefix + '-idle')

		// Network state (remote player only)
		this._netTarget = null
		this._netVelX = 0
		this._netVelY = 0
		this._netAge = 0 // ms since last network update

		// Name label — small tag above sprite
		this._label = null
	}

	// ── LOCAL player: called every frame ────────────────────────────────────
	// delta: ms since last frame (from Phaser update loop)
	// now:   current game time in ms (from Phaser update loop)
	updateLocal(keys, delta, now) {
		const body = this.body
		const onGround = body.blocked.down
		const dtS = Math.min(delta / 1000, 0.05) // seconds, capped at 50ms

		// Reset air abilities when grounded
		if (onGround) {
			this._usedAirDash = false
			this._usedDblJump = false
			if (this._dashActive && now >= this._dashEndMs) this._endDash()
		}

		// ── Horizontal movement — acceleration-based (Celeste RunAccel / RunReduce) ──
		if (!this._dashActive) {
			const mult = onGround ? 1 : AIR_MULT

			let moveDir = 0
			if (keys.left.isDown) {
				moveDir = -1
				this.setFlipX(true)
				this._facingRight = false
			}
			if (keys.right.isDown) {
				moveDir = 1
				this.setFlipX(false)
				this._facingRight = true
			}

			const velX = body.velocity.x
			const newVelX =
				moveDir !== 0
					? approach(velX, MAX_RUN * moveDir, RUN_ACCEL * mult * dtS)
					: approach(velX, 0, RUN_REDUCE * mult * dtS)

			body.setVelocityX(newVelX)
		}

		// ── Coyote time (JumpGraceTime) ─────────────────────────────────────────
		// Даёт JUMP_GRACE секунд прыжка после схода с края платформы
		if (onGround) {
			this._jumpGraceTimer = JUMP_GRACE
		} else {
			this._jumpGraceTimer = Math.max(0, this._jumpGraceTimer - dtS)
		}
		const canJump = this._jumpGraceTimer > 0

		// ── Jump & variable height ───────────────────────────────────────────────
		const jumpDown = keys.jump.isDown || keys.jumpW.isDown
		const jumpJust = jumpDown && !this._prevJump

		if (jumpJust) {
			if (canJump) {
				this._jumpGraceTimer = 0 // потребить coyote
				body.setVelocityY(JUMP_VEL)
				if (keys.left.isDown) body.setVelocityX(body.velocity.x - JUMP_HBOOST)
				else if (keys.right.isDown)
					body.setVelocityX(body.velocity.x + JUMP_HBOOST)
				this._varJumpTimer = VAR_JUMP_TIME
			} else if (
				this.unlockedAbilities.has('doubleJump') &&
				!this._usedDblJump
			) {
				body.setVelocityY(JUMP_VEL)
				this._usedDblJump = true
				this._varJumpTimer = VAR_JUMP_TIME
			}
		}

		// Variable jump: hold для поддержания скорости вверх
		if (jumpDown && this._varJumpTimer > 0 && body.velocity.y < 0) {
			this._varJumpTimer = Math.max(0, this._varJumpTimer - dtS)
			if (body.velocity.y > JUMP_VEL) body.setVelocityY(JUMP_VEL)
		} else if (!jumpDown) {
			this._varJumpTimer = 0
		}

		// Half gravity в apex (Celeste HalfGravThreshold)
		// Phaser уже применил полную гравитацию — добавляем обратно половину
		if (!onGround && Math.abs(body.velocity.y) <= HALF_GRAV_THRESHOLD) {
			body.setVelocityY(body.velocity.y + 900 * 0.5 * dtS)
		}

		// Ограничение скорости падения: зажать вниз → FastMaxFall (Celeste exact)
		const effectiveMaxFall =
			!onGround && keys.down.isDown ? FAST_MAX_FALL : MAX_FALL
		if (body.velocity.y > effectiveMaxFall) body.setVelocityY(effectiveMaxFall)

		this._prevJump = jumpDown

		// ── Dash ──────────────────────────────────────────────────────────────────
		if (Phaser.Input.Keyboard.JustDown(keys.dash)) {
			if (this.unlockedAbilities.has('dash')) {
				const canDash = now >= this._dashCdEndMs && !this._dashActive
				const airOk = onGround || !this._usedAirDash
				if (canDash && airOk) this._startDash(now)
			}
		}
		if (this._dashActive && now >= this._dashEndMs) this._endDash()

		// ── Ground Slam ───────────────────────────────────────────────────────────
		if (
			!onGround &&
			keys.down.isDown &&
			this.unlockedAbilities.has('groundSlam')
		) {
			body.setVelocityY(FAST_MAX_FALL)
		}

		// ── Wall Cling ────────────────────────────────────────────────────────────
		if (this.unlockedAbilities.has('wallCling') && !onGround) {
			const wallL = body.blocked.left
			const wallR = body.blocked.right
			if ((wallL && keys.left.isDown) || (wallR && keys.right.isDown)) {
				if (body.velocity.y > 20) body.setVelocityY(20) // WallSlideStartMax Celeste exact
				if (jumpJust) {
					// Wall jump: push away from wall
					body.setVelocityY(JUMP_VEL)
					body.setVelocityX(wallR ? -MAX_RUN * 1.5 : MAX_RUN * 1.5)
					this._varJumpTimer = VAR_JUMP_TIME
				}
			}
		}

		// ── Glide ─────────────────────────────────────────────────────────────────
		if (
			this.unlockedAbilities.has('glide') &&
			!onGround &&
			jumpDown &&
			!jumpJust
		) {
			if (body.velocity.y > 30) body.setVelocityY(30)
		}

		// ── Animation ─────────────────────────────────────────────────────────────
		if (this._animState !== 'attack') {
			const isMoving = !this._dashActive && Math.abs(body.velocity.x) > 5
			this._setAnim(isMoving ? 'run' : 'idle')
		}
	}

	// ── REMOTE player: called every frame ───────────────────────────────────
	// Velocity-predicted lerp — converges very fast for local network (<1ms RTT)
	updateRemote(delta) {
		if (!this._netTarget) {
			return
		}

		const dtS = Math.min((delta || 16) / 1000, 0.05)
		this._netAge += delta || 16

		// Velocity prediction: extrapolate from last known position over time since update
		// Only extrapolate up to 2 frames worth of time to avoid overshooting
		const predDt = Math.min(this._netAge / 1000, dtS * 2)
		const predX = this._netTarget.x + this._netVelX * predDt
		const predY = this._netTarget.y + this._netVelY * predDt

		const dx = predX - this.x
		const dy = predY - this.y
		const dist = Math.hypot(dx, dy)

		let nx, ny
		if (dist < 0.5) {
			// Already basically there — snap
			nx = predX
			ny = predY
		} else if (dist > 48) {
			// Large teleport (respawn / level transition) — snap immediately
			nx = predX
			ny = predY
		} else {
			// Smooth lerp: converge in ~3 frames at 60fps for local LAN
			// factor ≈ min(1, dtS * 30) ≈ 0.5 per frame → reaches within 1px in ~4 frames
			const factor = Math.min(1, dtS * 30)
			nx = this.x + dx * factor
			ny = this.y + dy * factor
		}

		this.body.reset(nx, ny)
		this.body.setVelocity(0, 0)

		// Animation for remote player derived from network velocity
		if (this._animState !== 'attack') {
			this._setAnim(Math.abs(this._netVelX) > 5 ? 'run' : 'idle')
		}
	}

	setNetworkState(state) {
		this._netTarget = { x: state.x, y: state.y }
		this._netVelX = state.vx || 0
		this._netVelY = state.vy || 0
		this._netAge = 0
		this._netDashActive = state.isDashing ?? false
		if (state.flipX !== undefined) this.setFlipX(state.flipX)
		if (state.anim === 'attack' && this._animState !== 'attack')
			this.playAttack()
	}

	getNetworkState() {
		return {
			x: this.x,
			y: this.y,
			flipX: this.flipX,
			vx: this.body.velocity.x,
			vy: this.body.velocity.y,
			anim: this._animState,
			isDashing: this._dashActive,
		}
	}

	// ── Animation helpers ────────────────────────────────────────────────────
	// Переключает анимацию; атака не прерывается
	_setAnim(state) {
		if (this._animState === state) return
		if (this._animState === 'attack' || this._animState === 'shield') return
		this._animState = state
		this.play(this._charPrefix + '-' + state)
	}

	playAttack() {
		if (this._animState === 'attack') return
		this._animState = 'attack'
		const key = this._charPrefix + '-attack'
		this.play(key)
		this.once('animationcomplete-' + key, () => {
			this._animState = 'idle'
		})
	}

	playHit() {
		if (this._animState === 'attack') return
		this._animState = 'attack'
		const key = this._charPrefix + '-hit'
		this.play(key)
		this.once('animationcomplete-' + key, () => {
			this._animState = 'idle'
		})
	}

	playDead() {
		this._animState = 'attack'
		const key = this._charPrefix + '-dead'
		this.play(key)
		this.once('animationcomplete-' + key, () => {
			this._animState = 'idle'
		})
	}

	// toggle: первый клик = щит, второй = снять щит
	playShieldToggle() {
		if (this._animState === 'shield') {
			this._animState = 'idle'
			this.play(this._charPrefix + '-idle')
		} else {
			this._animState = 'shield'
			this.play(this._charPrefix + '-shield')
		}
	}

	unlock(ability) {
		if (!ability) return
		this.unlockedAbilities.add(ability)
		console.log('[Player] Ability unlocked:', ability)
	}
	hasAbility(a) {
		return this.unlockedAbilities.has(a)
	}

	_startDash(now) {
		this._dashActive = true
		this._dashEndMs = now + DASH_SECS * 1000
		this._dashCdEndMs = now + DASH_CD * 1000
		this._usedAirDash = true
		const dir = this._facingRight ? 1 : -1
		this.body.setVelocityX(dir * DASH_SPEED)
		this.body.setVelocityY(-20)
		this.body.setAllowGravity(false)
	}

	_endDash() {
		this._dashActive = false
		this.body.setAllowGravity(true)
		// Всегда сбрасываем до END_DASH_SPEED — без этого на земле стоя
		// скорость 380 гасилась через RUN_REDUCE (0.76s, +144px) вместо нормального
		const dir = this._facingRight ? 1 : -1
		this.body.setVelocityX(dir * END_DASH_SPEED)
	}

	destroy() {
		this._label?.destroy()
		super.destroy()
	}
}
