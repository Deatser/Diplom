import Phaser from 'phaser'

// ── HK-accurate physics constants ──
// Gravity is set to 1400 in GameManager (was 900)
const SPEED      = 280    // px/s horizontal run (HK ≈ 8.5 tiles/s × 32 = 272)
const JUMP_VEL   = -610   // px/s upward (clears ≈4 tiles at gravity 1400)
const DASH_DIST  = 1200   // px/s during dash — gives ~168px over 140ms (≈8 char-widths)
const DASH_DUR   = 140    // ms
const DASH_CD    = 600    // ms cooldown

export class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, textureKey, isLocal) {
    super(scene, x, y, textureKey)
    scene.add.existing(this)
    scene.physics.add.existing(this)

    this.isLocal = isLocal
    this.setDepth(10)
    // Hitbox matches new 20×34 texture
    this.body.setSize(16, 28).setOffset(2, 6)
    this.setCollideWorldBounds(true)

    // Ability state
    this.unlockedAbilities = new Set()
    this._prevJump   = false
    this._dashEnd    = 0
    this._dashCdEnd  = 0
    this._dashActive = false
    this._usedAirDash = false
    this._usedDblJump = false
    this._facingRight = true

    // Network state (remote player only)
    this._netTarget = null
    this._netVelX   = 0
    this._netVelY   = 0

    // Name label
    this._label = scene.add.text(x, y - 30, isLocal ? 'Ты' : 'Партнёр', {
      fontSize: '11px', color: '#ffffff88', fontFamily: 'monospace'
    }).setOrigin(0.5).setDepth(11)
  }

  // ── Called every frame for LOCAL player ──
  updateLocal(keys, now) {
    const body    = this.body
    const onGround = body.blocked.down

    if (onGround) {
      this._usedAirDash = false
      this._usedDblJump = false
      if (this._dashActive && now >= this._dashEnd) this._endDash()
    }

    // ── Horizontal ──
    if (!this._dashActive) {
      if (keys.left.isDown) {
        body.setVelocityX(-SPEED)
        this.setFlipX(true); this._facingRight = false
      } else if (keys.right.isDown) {
        body.setVelocityX(SPEED)
        this.setFlipX(false); this._facingRight = true
      } else {
        body.setVelocityX(0)
      }
    }

    // ── Jump ──
    const jumpDown = keys.jump.isDown || keys.jumpW.isDown
    const jumpJust = jumpDown && !this._prevJump
    if (jumpJust) {
      if (onGround) {
        body.setVelocityY(JUMP_VEL)
      } else if (this.unlockedAbilities.has('doubleJump') && !this._usedDblJump) {
        body.setVelocityY(JUMP_VEL)  // same force as ground jump (HK-style)
        this._usedDblJump = true
      }
    }
    this._prevJump = jumpDown

    // ── Dash (Shift) ──
    if (Phaser.Input.Keyboard.JustDown(keys.dash)) {
      if (this.unlockedAbilities.has('dash')) {
        const canDash = now >= this._dashCdEnd && !this._dashActive
        const airOk   = onGround || !this._usedAirDash
        if (canDash && airOk) this._startDash(now)
      }
    }
    if (this._dashActive && now >= this._dashEnd) this._endDash()

    // ── Ground Slam ──
    if (!onGround && keys.down.isDown && this.unlockedAbilities.has('groundSlam')) {
      if (body.velocity.y < 700) body.setVelocityY(800)
    }

    // ── Wall Cling ──
    if (this.unlockedAbilities.has('wallCling') && !onGround) {
      const wallL = body.blocked.left
      const wallR = body.blocked.right
      if ((wallL && keys.left.isDown) || (wallR && keys.right.isDown)) {
        if (body.velocity.y > 80) body.setVelocityY(80)
        if (jumpJust) {
          body.setVelocityY(JUMP_VEL)
          body.setVelocityX(wallR ? -SPEED * 1.5 : SPEED * 1.5)
        }
      }
    }

    // ── Glide ──
    if (this.unlockedAbilities.has('glide') && !onGround && jumpDown && !jumpJust) {
      if (body.velocity.y > 0 && body.velocity.y > 90) body.setVelocityY(90)
    }

    // Update label
    this._label.setPosition(this.x, this.y - 22)
  }

  // ── Called every frame for REMOTE player ──
  // Uses velocity-assisted interpolation for smoothness between 50ms network ticks
  updateRemote(delta) {
    if (!this._netTarget) {
      this._label.setPosition(this.x, this.y - 22)
      return
    }

    // Higher lerp factor (0.4) vs old 0.25 → reaches target in ~2 frames instead of 4+
    // Also apply a slight prediction from last-known velocity to reduce apparent lag
    const dtS = Math.min((delta || 16) / 1000, 0.05)
    const predX = this.x + this._netVelX * dtS * 0.5
    const predY = this.y + this._netVelY * dtS * 0.5

    const nx = Phaser.Math.Linear(predX, this._netTarget.x, 0.40)
    const ny = Phaser.Math.Linear(predY, this._netTarget.y, 0.40)

    this.body.reset(nx, ny)
    this.body.setVelocity(0, 0)
    this._label.setPosition(this.x, this.y - 22)
  }

  setNetworkState(state) {
    this._netTarget = { x: state.x, y: state.y }
    this._netVelX   = state.vx || 0
    this._netVelY   = state.vy || 0
    if (state.flipX !== undefined) this.setFlipX(state.flipX)
  }

  getNetworkState() {
    return {
      x: this.x, y: this.y,
      flipX: this.flipX,
      vx: this.body.velocity.x,
      vy: this.body.velocity.y
    }
  }

  unlock(ability) {
    if (!ability) return
    this.unlockedAbilities.add(ability)
    console.log('[Player] Ability unlocked:', ability)
  }
  hasAbility(a) { return this.unlockedAbilities.has(a) }

  _startDash(now) {
    this._dashActive  = true
    this._dashEnd     = now + DASH_DUR
    this._dashCdEnd   = now + DASH_CD
    this._usedAirDash = true
    const dir = this._facingRight ? 1 : -1
    this.body.setVelocityX(dir * DASH_DIST)
    this.body.setVelocityY(-40)   // slight upward arc like HK
    this.body.setAllowGravity(false)  // no gravity during dash
    this.scene.spawnDashParticles(this.x, this.y, this._facingRight)
    console.log('[Player] Dash! dir=', dir, 'vel=', dir * DASH_DIST)
  }

  _endDash() {
    this._dashActive = false
    this.body.setAllowGravity(true)
    // Carry some momentum after dash
    const dir = this._facingRight ? 1 : -1
    if (!this.body.blocked.down) this.body.setVelocityX(dir * SPEED * 0.5)
  }

  destroy() {
    this._label?.destroy()
    super.destroy()
  }
}
