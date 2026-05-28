import Phaser from 'phaser'

// ── Celeste-proportional physics constants ──────────────────────────────────
// Both games use 320×180 viewport. Celeste tiles = 8px, ours = 16px.
// Speed/accel values scaled ×1.67 so movement FEELS the same tile-for-tile.
// Gravity kept at 900 (Celeste exact) — set in GameManager.js arcade config.

const MAX_RUN    = 150   // px/s  — Celeste 90 × 1.67
const RUN_ACCEL  = 1200  // px/s² — acceleration to max speed
const RUN_REDUCE = 600   // px/s² — deceleration when releasing key
const AIR_MULT   = 0.65  // air-control multiplier (exact Celeste value)

const JUMP_VEL      = -360   // px/s upward  → apex ≈ 72px = 4.5 tiles at gravity 900
const JUMP_HBOOST   = 24     // horizontal boost added on jump while moving
const VAR_JUMP_TIME = 0.20   // seconds: hold Space/W for extra height (Celeste value)
const MAX_FALL      = 320    // px/s terminal fall velocity

const DASH_SPEED = 480       // px/s  → ~58px per 0.12s ≈ 3.6 tiles
const DASH_SECS  = 0.12      // seconds dash active
const DASH_CD    = 0.25      // seconds cooldown

// Sprite texture: 10×16 world-pixels (same visual footprint as Celeste on 320×180)
// Hitbox: 8×11 (Celeste exact), bottom-aligned inside 10×16 sprite
const SPR_W = 10, SPR_H = 16
const HB_W  =  8, HB_H  = 11

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

    // Celeste hitbox 8×11, bottom-aligned in 10×16 sprite
    // offset x: (SPR_W - HB_W) / 2 = 1
    // offset y: SPR_H - HB_H = 5
    this.body.setSize(HB_W, HB_H).setOffset(1, 5)
    this.setCollideWorldBounds(true)

    // Ability state
    this.unlockedAbilities = new Set()
    this._prevJump     = false
    this._dashEndMs    = 0
    this._dashCdEndMs  = 0
    this._dashActive   = false
    this._usedAirDash  = false
    this._usedDblJump  = false
    this._facingRight  = true
    this._varJumpTimer = 0   // seconds remaining for variable-height jump

    // Network state (remote player only)
    this._netTarget = null
    this._netVelX   = 0
    this._netVelY   = 0
    this._netAge    = 0   // ms since last network update

    // Name label — small tag above sprite
    this._label = scene.add.text(x, y - 12, isLocal ? 'Ты' : 'Партнёр', {
      fontSize: '5px', color: '#ffffff99', fontFamily: 'monospace'
    }).setOrigin(0.5).setDepth(11)
  }

  // ── LOCAL player: called every frame ────────────────────────────────────
  // delta: ms since last frame (from Phaser update loop)
  // now:   current game time in ms (from Phaser update loop)
  updateLocal(keys, delta, now) {
    const body     = this.body
    const onGround = body.blocked.down
    const dtS      = Math.min(delta / 1000, 0.05)   // seconds, capped at 50ms

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
      if (keys.left.isDown)  { moveDir = -1; this.setFlipX(true);  this._facingRight = false }
      if (keys.right.isDown) { moveDir =  1; this.setFlipX(false); this._facingRight = true  }

      const velX = body.velocity.x
      const newVelX = moveDir !== 0
        ? approach(velX, MAX_RUN * moveDir, RUN_ACCEL * mult * dtS)
        : approach(velX, 0,                RUN_REDUCE * mult * dtS)

      body.setVelocityX(newVelX)
    }

    // ── Jump & variable height ───────────────────────────────────────────────
    const jumpDown = keys.jump.isDown || keys.jumpW.isDown
    const jumpJust = jumpDown && !this._prevJump

    if (jumpJust) {
      if (onGround) {
        body.setVelocityY(JUMP_VEL)
        // Celeste horizontal boost on jump while moving
        if (keys.left.isDown)       body.setVelocityX(body.velocity.x - JUMP_HBOOST)
        else if (keys.right.isDown) body.setVelocityX(body.velocity.x + JUMP_HBOOST)
        this._varJumpTimer = VAR_JUMP_TIME
      } else if (this.unlockedAbilities.has('doubleJump') && !this._usedDblJump) {
        body.setVelocityY(JUMP_VEL)
        this._usedDblJump = true
        this._varJumpTimer = VAR_JUMP_TIME
      }
    }

    // Variable jump: hold to maintain upward velocity (Celeste style)
    // Only sustains if still going upward and within the time window
    if (jumpDown && this._varJumpTimer > 0 && body.velocity.y < 0) {
      this._varJumpTimer = Math.max(0, this._varJumpTimer - dtS)
      // Clamp upward velocity to JUMP_VEL (don't let it go faster up)
      if (body.velocity.y > JUMP_VEL) body.setVelocityY(JUMP_VEL)
    } else if (!jumpDown) {
      this._varJumpTimer = 0
    }

    // Cap fall speed (Celeste MaxFall)
    if (body.velocity.y > MAX_FALL) body.setVelocityY(MAX_FALL)

    this._prevJump = jumpDown

    // ── Dash ──────────────────────────────────────────────────────────────────
    if (Phaser.Input.Keyboard.JustDown(keys.dash)) {
      if (this.unlockedAbilities.has('dash')) {
        const canDash = now >= this._dashCdEndMs && !this._dashActive
        const airOk   = onGround || !this._usedAirDash
        if (canDash && airOk) this._startDash(now)
      }
    }
    if (this._dashActive && now >= this._dashEndMs) this._endDash()

    // ── Ground Slam ───────────────────────────────────────────────────────────
    if (!onGround && keys.down.isDown && this.unlockedAbilities.has('groundSlam')) {
      if (body.velocity.y < MAX_FALL) body.setVelocityY(MAX_FALL)
    }

    // ── Wall Cling ────────────────────────────────────────────────────────────
    if (this.unlockedAbilities.has('wallCling') && !onGround) {
      const wallL = body.blocked.left
      const wallR = body.blocked.right
      if ((wallL && keys.left.isDown) || (wallR && keys.right.isDown)) {
        // Slow slide down wall
        if (body.velocity.y > 30) body.setVelocityY(30)
        if (jumpJust) {
          // Wall jump: push away from wall
          body.setVelocityY(JUMP_VEL)
          body.setVelocityX(wallR ? -MAX_RUN * 1.5 : MAX_RUN * 1.5)
          this._varJumpTimer = VAR_JUMP_TIME
        }
      }
    }

    // ── Glide ─────────────────────────────────────────────────────────────────
    if (this.unlockedAbilities.has('glide') && !onGround && jumpDown && !jumpJust) {
      if (body.velocity.y > 30) body.setVelocityY(30)
    }

    this._label.setPosition(this.x, this.y - 10)
  }

  // ── REMOTE player: called every frame ───────────────────────────────────
  // Velocity-predicted lerp — converges very fast for local network (<1ms RTT)
  updateRemote(delta) {
    if (!this._netTarget) {
      this._label.setPosition(this.x, this.y - 10)
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
      nx = predX; ny = predY
    } else if (dist > 48) {
      // Large teleport (respawn / level transition) — snap immediately
      nx = predX; ny = predY
    } else {
      // Smooth lerp: converge in ~3 frames at 60fps for local LAN
      // factor ≈ min(1, dtS * 30) ≈ 0.5 per frame → reaches within 1px in ~4 frames
      const factor = Math.min(1, dtS * 30)
      nx = this.x + dx * factor
      ny = this.y + dy * factor
    }

    this.body.reset(nx, ny)
    this.body.setVelocity(0, 0)
    this._label.setPosition(this.x, this.y - 10)
  }

  setNetworkState(state) {
    this._netTarget = { x: state.x, y: state.y }
    this._netVelX   = state.vx || 0
    this._netVelY   = state.vy || 0
    this._netAge    = 0   // reset prediction timer on fresh update
    if (state.flipX !== undefined) this.setFlipX(state.flipX)
  }

  getNetworkState() {
    return {
      x:     this.x,
      y:     this.y,
      flipX: this.flipX,
      vx:    this.body.velocity.x,
      vy:    this.body.velocity.y
    }
  }

  unlock(ability) {
    if (!ability) return
    this.unlockedAbilities.add(ability)
    console.log('[Player] Ability unlocked:', ability)
  }
  hasAbility(a) { return this.unlockedAbilities.has(a) }

  _startDash(now) {
    this._dashActive   = true
    this._dashEndMs    = now + DASH_SECS * 1000
    this._dashCdEndMs  = now + DASH_CD   * 1000
    this._usedAirDash  = true
    const dir = this._facingRight ? 1 : -1
    this.body.setVelocityX(dir * DASH_SPEED)
    this.body.setVelocityY(-20)          // tiny upward arc (like Celeste 8-dir dash → neutral Y)
    this.body.setAllowGravity(false)     // no gravity during dash (Celeste exact)
    this.scene.spawnDashParticles(this.x, this.y, this._facingRight)
  }

  _endDash() {
    this._dashActive = false
    this.body.setAllowGravity(true)
    // Carry partial horizontal momentum post-dash (Celeste: keep MaxRun in dash direction)
    const dir = this._facingRight ? 1 : -1
    if (!this.body.blocked.down) {
      this.body.setVelocityX(dir * MAX_RUN)
    }
  }

  destroy() {
    this._label?.destroy()
    super.destroy()
  }
}
