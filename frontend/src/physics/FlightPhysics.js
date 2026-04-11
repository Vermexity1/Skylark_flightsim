// ============================================================
// Flight Physics — Aerodynamic force calculations
// Uses simplified real physics: lift/drag/gravity/thrust
// ============================================================
import { Vector3, MathUtils } from 'three';
import { PHYSICS } from '../config.js';

// Pre-allocated vectors to avoid per-frame GC pressure
const _forward    = new Vector3();
const _up         = new Vector3();
const _right      = new Vector3();
const _velDir     = new Vector3();
const _liftDir    = new Vector3();

export class FlightPhysics {
  /**
   * Calculate net aerodynamic force on aircraft this frame.
   * @param {object} state   - { position, velocity, quaternion, throttle }
   * @param {object} config  - aircraft config from config.js AIRCRAFT[type]
   * @returns {Vector3}      - net force in world space (Newtons)
   */
  static calculate(state, config) {
    const { velocity, quaternion, throttle, brake } = state;

    const speed   = velocity.length();
    const speedSq = speed * speed;

    // Aircraft orientation vectors in world space
    _forward.set(0, 0, -1).applyQuaternion(quaternion);
    _up.set(0, 1, 0).applyQuaternion(quaternion);
    _right.set(1, 0, 0).applyQuaternion(quaternion);

    const force = new Vector3(0, 0, 0);

    // ── Gravity ──────────────────────────────────────────────
    force.y -= config.mass * PHYSICS.GRAVITY;

    // ── Thrust ───────────────────────────────────────────────
    const thrustMag = config.maxThrust * throttle;
    force.addScaledVector(_forward, thrustMag);

    // ── Aerodynamics (only when moving) ──────────────────────
    if (speed > 1) {
      _velDir.copy(velocity).normalize();

      // Angle of Attack — angle between forward and velocity direction
      const dot = MathUtils.clamp(_forward.dot(_velDir), -1, 1);
      const aoa = Math.acos(dot);

      // ── Lift ─────────────────────────────────────────────
      // Cl peaks near stall angle, drops sharply past it
      let liftCoeff = config.liftCoefficient * Math.sin(2 * aoa);
      if (aoa > PHYSICS.STALL_ANGLE) {
        const stalledPct = (aoa - PHYSICS.STALL_ANGLE) * 3.0;
        liftCoeff *= Math.max(0, 1 - stalledPct);
      }
      // Lift follows the banked wing plane so roll contributes to turning.
      _liftDir.copy(_right).cross(_velDir);
      if (_liftDir.lengthSq() < 0.0001) {
        _liftDir.copy(_up);
      } else {
        _liftDir.normalize();
      }
      const liftMag = 0.5 * PHYSICS.AIR_DENSITY * speedSq * config.wingArea * Math.abs(liftCoeff);
      force.addScaledVector(_liftDir, liftMag);

      // ── Drag ─────────────────────────────────────────────
      // Parasitic drag + induced drag (rises with lift²)
      const inducedDrag = (liftCoeff * liftCoeff) / (Math.PI * 6.5);
      const airBrakeFactor = brake ? 2.6 : 1;
      const totalDragCoeff = (config.dragCoefficient + inducedDrag) * airBrakeFactor;
      const dragMag = 0.5 * PHYSICS.AIR_DENSITY * speedSq * config.wingArea * totalDragCoeff;
      force.addScaledVector(_velDir, -dragMag);

      // ── Side-slip damping (yaw stability) ────────────────
      const sideSlip = _right.dot(_velDir);
      force.addScaledVector(_right, -sideSlip * config.mass * 0.9);

      // ── Turbulence ───────────────────────────────────────
      if (PHYSICS.TURBULENCE_INTENSITY > 0) {
        const turb = PHYSICS.TURBULENCE_INTENSITY * speed * 0.007;
        force.x += (Math.random() - 0.5) * turb * config.mass;
        force.y += (Math.random() - 0.5) * turb * config.mass * 0.25;
        force.z += (Math.random() - 0.5) * turb * config.mass;
      }
    }

    return force;
  }
}
