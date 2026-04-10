// ============================================================
// Aircraft Models — Procedural THREE.js geometry for each type
// ============================================================
import * as THREE from 'three';
import { AIRCRAFT } from '../config.js';
import { ASSET_SOURCES } from '../assets/AssetCatalog.js';
import { AssetLoader } from '../assets/AssetLoader.js';

const assetLoader = new AssetLoader();

export class AircraftModels {
  static create(type) {
    const config = AIRCRAFT[type];
    if (!config) return new THREE.Group();
    const root = new THREE.Group();
    const fallback = (() => {
      switch (type) {
      case 'prop':    return AircraftModels._createProp(config);
      case 'jet':     return AircraftModels._createJet(config);
      case 'fighter': return AircraftModels._createFighter(config);
      case 'glider':  return AircraftModels._createGlider(config);
      case 'stunt':   return AircraftModels._createStunt(config);
      case 'cargo':   return AircraftModels._createCargo(config);
      case 'airliner': return AircraftModels._createJet(config);
      case 'raptor': return AircraftModels._createFighter(config);
      case 'mustang': return AircraftModels._createMustang(config);
      case 'concorde': return AircraftModels._createConcorde(config);
      case 'blackbird': return AircraftModels._createBlackbird(config);
      case 'custom_upload': return AircraftModels._createJet(config);
      default:        return AircraftModels._createProp(config);
      }
    })();

    root.add(fallback);
    root.userData.fallbackModel = fallback;
    AircraftModels._hydrateDetailedModel(root, type, config);
    return root;
  }

  static _mat(color, flat = true) {
    return new THREE.MeshPhongMaterial({ color, flatShading: flat, shininess: 40 });
  }
  static _glossMat(color) {
    return new THREE.MeshPhongMaterial({ color, flatShading: false, shininess: 120, specular: 0x888888 });
  }
  static _applyShading(group) {
    group.traverse(c => {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });
  }

  static _collectModelPoints(root) {
    root.updateMatrixWorld(true);
    const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const point = new THREE.Vector3();
    const points = [];

    root.traverse(node => {
      if (!node.isMesh) return;
      const positions = node.geometry?.attributes?.position;
      if (!positions) return;

      const step = Math.max(1, Math.ceil(positions.count / 900));
      for (let i = 0; i < positions.count; i += step) {
        point
          .fromBufferAttribute(positions, i)
          .applyMatrix4(node.matrixWorld)
          .applyMatrix4(rootInverse);
        points.push(point.clone());
      }
    });

    return points;
  }

  static _profileModelEnd(points, axis, start, end) {
    const orthA = axis === 'x' ? 'y' : 'x';
    const orthB = axis === 'z' ? 'y' : 'z';
    let count = 0;
    let radial = 0;
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;

    for (const point of points) {
      const value = point[axis];
      if (value < start || value > end) continue;
      count++;
      radial += Math.hypot(point[orthA], point[orthB]);
      minA = Math.min(minA, point[orthA]);
      maxA = Math.max(maxA, point[orthA]);
      minB = Math.min(minB, point[orthB]);
      maxB = Math.max(maxB, point[orthB]);
    }

    if (!count) return Infinity;
    const spreadA = maxA - minA;
    const spreadB = maxB - minB;
    return (radial / count) * 0.75 + (spreadA + spreadB) * 0.35;
  }

  static _scoreForwardAxis(points, bounds, axis) {
    const min = bounds.min[axis];
    const max = bounds.max[axis];
    const span = Math.max(0.001, max - min);
    const slice = Math.max(span * 0.12, 0.12);
    const minScore = AircraftModels._profileModelEnd(points, axis, min, min + slice);
    const maxScore = AircraftModels._profileModelEnd(points, axis, max - slice, max);
    if (!Number.isFinite(minScore) || !Number.isFinite(maxScore)) {
      return { axis, asymmetry: -Infinity, forwardSign: -1, span };
    }
    const asymmetry = Math.abs(maxScore - minScore) / Math.max(0.001, minScore + maxScore);
    const forwardSign = maxScore < minScore ? 1 : -1;
    return { axis, asymmetry, forwardSign, span };
  }

  static _detectForwardVector(root) {
    const points = AircraftModels._collectModelPoints(root);
    if (points.length < 8) return new THREE.Vector3(0, 0, -1);

    const bounds = new THREE.Box3().setFromPoints(points);
    const xAxis = AircraftModels._scoreForwardAxis(points, bounds, 'x');
    const zAxis = AircraftModels._scoreForwardAxis(points, bounds, 'z');
    const axisChoice = xAxis.asymmetry === zAxis.asymmetry
      ? (xAxis.span > zAxis.span ? xAxis : zAxis)
      : (xAxis.asymmetry > zAxis.asymmetry ? xAxis : zAxis);

    return axisChoice.axis === 'x'
      ? new THREE.Vector3(axisChoice.forwardSign, 0, 0)
      : new THREE.Vector3(0, 0, axisChoice.forwardSign);
  }

  static _hydrateDetailedModel(root, type, config) {
    const source = ASSET_SOURCES.aircraft[type];
    if (!source) return;

    assetLoader.loadGLTF(source).then(model => {
      if (!model) return;

      const detailed = model;
      const forwardVector = AircraftModels._detectForwardVector(detailed).normalize();
      const alignQuat = new THREE.Quaternion().setFromUnitVectors(forwardVector, new THREE.Vector3(0, 0, -1));
      detailed.applyQuaternion(alignQuat);

      const manualRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        source.rotationX ?? 0,
        source.rotationY ?? 0,
        source.rotationZ ?? 0
      ));
      detailed.applyQuaternion(manualRotation);
      detailed.updateMatrixWorld(true);

      const sourceBox = new THREE.Box3().setFromObject(detailed);
      const sourceSize = sourceBox.getSize(new THREE.Vector3());
      const longestAxis = Math.max(sourceSize.x, sourceSize.z, sourceSize.y, 0.001);
      const targetLength = source.targetLength ?? 12;
      const scale = targetLength / longestAxis;

      detailed.scale.setScalar(scale);
      detailed.updateMatrixWorld(true);

      const alignedBox = new THREE.Box3().setFromObject(detailed);
      const alignedCenter = alignedBox.getCenter(new THREE.Vector3());
      detailed.position.x -= alignedCenter.x;
      detailed.position.z -= alignedCenter.z;
      detailed.position.y -= alignedCenter.y;
      detailed.position.y += source.offsetY ?? 0;
      detailed.updateMatrixWorld(true);

      detailed.traverse(node => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;

        if (node.material) {
          const material = Array.isArray(node.material) ? node.material : [node.material];
          material.forEach(mat => {
            if ('color' in mat) {
              if (mat.map) mat.color.set(0xffffff);
              else mat.color.lerp(new THREE.Color(config.color), 0.82);
            }
            if ('roughness' in mat) mat.roughness = Math.min(mat.roughness ?? 0.7, 0.82);
            if ('metalness' in mat) mat.metalness = Math.max(mat.metalness ?? 0.05, 0.08);
            if ('envMapIntensity' in mat) mat.envMapIntensity = 0.45;
          });
        }
      });

      root.clear();
      root.add(detailed);
      root.userData.activeModel = detailed;
      root.userData.onHydrated?.(detailed);
    });
  }

  // ── Cessna 172 (Prop) ──────────────────────────────────────
  static _createProp(cfg) {
    const g   = new THREE.Group();
    const mat = this._mat(cfg.color);
    const acc = this._mat(cfg.accentColor);
    const dk  = this._mat(0x222222);

    // Fuselage
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.38, 6.5, 8), mat);
    fuse.rotation.x = Math.PI / 2;
    g.add(fuse);

    // Nose cone
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 8), mat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -4.15;
    g.add(nose);

    // Tail boom
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.12, 2.5, 6), mat);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = 4.0;
    g.add(tail);

    // Main wings (high-wing monoplane)
    const wingGeo = new THREE.BoxGeometry(8.5, 0.12, 1.6);
    const wing = new THREE.Mesh(wingGeo, mat);
    wing.position.set(0, 0.4, 0.3);
    g.add(wing);

    // Wing stripes
    const stripeGeo = new THREE.BoxGeometry(8.0, 0.14, 0.35);
    const stripe = new THREE.Mesh(stripeGeo, acc);
    stripe.position.set(0, 0.42, 0.15);
    g.add(stripe);

    // Horizontal stabilizer
    const hStab = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.1, 0.9), mat);
    hStab.position.set(0, 0.1, 4.6);
    g.add(hStab);

    // Vertical stabilizer
    const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 1.1), mat);
    vStab.position.set(0, 0.55, 4.3);
    g.add(vStab);

    // Engine cowl
    const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.58, 0.6, 10), dk);
    cowl.rotation.x = Math.PI / 2;
    cowl.position.z = -3.5;
    g.add(cowl);

    // Propeller
    const propHub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8), dk);
    propHub.rotation.x = Math.PI / 2;
    propHub.position.z = -3.85;
    g.add(propHub);

    const propGroup = new THREE.Group();
    propGroup.name = 'propeller';
    propGroup.position.z = -3.95;
    [-1, 1].forEach(side => {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.15, 0.05), dk);
      blade.position.y = side * 0.55;
      propGroup.add(blade);
    });
    g.add(propGroup);

    // Landing gear
    [-1.2, 1.2].forEach(x => {
      const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 5), dk);
      gear.position.set(x, -0.6, 0.8);
      g.add(gear);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 5, 12), dk);
      wheel.position.set(x, -0.85, 0.8);
      wheel.rotation.y = Math.PI / 2;
      g.add(wheel);
    });

    this._applyShading(g);
    return g;
  }

  // ── Learjet 45 (Jet) ───────────────────────────────────────
  static _createJet(cfg) {
    const g   = new THREE.Group();
    const mat = this._glossMat(cfg.color);
    const acc = this._mat(cfg.accentColor);
    const dk  = this._mat(0x111111);
    const eng = this._mat(0x333333);

    // Fuselage (longer, sleeker)
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.45, 9, 10), mat);
    fuse.rotation.x = Math.PI / 2;
    g.add(fuse);

    // Pointed nose
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.62, 2.5, 10), mat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -5.75;
    g.add(nose);

    // Tail section
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.18, 3, 8), mat);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = 5.5;
    g.add(tail);

    // Swept wings
    const wingL = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.1, 1.8), mat);
    wingL.position.set(-2.8, -0.1, 0.5);
    wingL.rotation.y = -0.18;
    g.add(wingL);
    const wingR = wingL.clone();
    wingR.position.x = 2.8;
    wingR.rotation.y = 0.18;
    g.add(wingR);

    // Wing accent stripe
    [wingL, wingR].forEach((w, i) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 0.25), acc);
      s.position.copy(w.position);
      s.position.y += 0.01;
      s.rotation.y = w.rotation.y;
      g.add(s);
    });

    // Rear-mounted engines (pod style)
    [-1, 1].forEach(side => {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 2.5, 8), eng);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(side * 1.2, 0.2, 3.5);
      g.add(pod);

      // Engine nacelle
      const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.4, 8), dk);
      nac.rotation.x = Math.PI / 2;
      nac.position.set(side * 1.2, 0.2, 4.8);
      g.add(nac);
    });

    // H-tail
    const hStab = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.09, 1.0), mat);
    hStab.position.set(0, 0, 7.0);
    g.add(hStab);
    const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 1.3), mat);
    vStab.position.set(0, 0.7, 6.8);
    g.add(vStab);

    // Windows strip
    const windows = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 3.5), this._mat(0xAADDFF));
    windows.position.set(0.64, 0.2, -0.5);
    g.add(windows);
    const windows2 = windows.clone();
    windows2.position.x = -0.64;
    g.add(windows2);

    this._applyShading(g);
    return g;
  }

  // ── F-16 Falcon (Fighter) ──────────────────────────────────
  static _createFighter(cfg) {
    const g   = new THREE.Group();
    const mat = this._glossMat(cfg.color);
    const acc = this._mat(cfg.accentColor);
    const dk  = this._mat(0x111111);
    const can = this._mat(0x334455); // canopy

    // Long sleek fuselage
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.35, 11, 8), mat);
    fuse.rotation.x = Math.PI / 2;
    g.add(fuse);

    // Sharp nose
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.58, 4.5, 8), mat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -7.75;
    g.add(nose);

    // Canopy
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), can);
    canopy.position.set(0, 0.5, -1.5);
    g.add(canopy);

    // Delta wings
    const wingGeo = new THREE.BufferGeometry();
    const verts = new Float32Array([
      0, 0, -1,   4.5, -0.1, 3.5,   0, 0, 3.5,
      0, 0, -1,   0,   -0.1, 3.5,   4.5, -0.1, 3.5,
    ]);
    wingGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    wingGeo.computeVertexNormals();
    const wingL = new THREE.Mesh(wingGeo, mat);
    wingL.position.set(0, -0.1, -1);
    g.add(wingL);
    const wingR = wingL.clone();
    wingR.scale.x = -1;
    g.add(wingR);

    // Canards (front fins)
    const canardGeo = new THREE.BufferGeometry();
    const cv = new Float32Array([
      0, 0, 0,   1.8, -0.05, 1.2,  0, 0, 1.2,
      0, 0, 0,   0,   -0.05, 1.2,  1.8, -0.05, 1.2,
    ]);
    canardGeo.setAttribute('position', new THREE.BufferAttribute(cv, 3));
    canardGeo.computeVertexNormals();
    const canardL = new THREE.Mesh(canardGeo, mat);
    canardL.position.set(0.4, 0, -4.0);
    g.add(canardL);
    const canardR = canardL.clone();
    canardR.scale.x = -1;
    canardR.position.x = -0.4;
    g.add(canardR);

    // Twin tail fins
    [-0.5, 0.5].forEach(x => {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 1.4), mat);
      fin.position.set(x, 0.7, 4.5);
      fin.rotation.z = x > 0 ? -0.1 : 0.1;
      g.add(fin);
    });

    // Engine intake
    const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.8, 8), dk);
    intake.rotation.x = Math.PI / 2;
    intake.position.set(0, -0.25, 0.5);
    g.add(intake);

    // Afterburner nozzle
    const ab = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.2, 8), dk);
    ab.rotation.x = Math.PI / 2;
    ab.position.z = 6.5;
    g.add(ab);

    // Afterburner flame (hidden by default)
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xFF8800, transparent: true, opacity: 0.7 });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.0, 8), flameMat);
    flame.rotation.x = Math.PI / 2;
    flame.position.z = 7.8;
    flame.name = 'afterburner';
    flame.visible = false;
    g.add(flame);

    this._applyShading(g);
    return g;
  }

  // ── ASW 28 Glider ──────────────────────────────────────────
  static _createGlider(cfg) {
    const g   = new THREE.Group();
    const mat = this._glossMat(cfg.color);
    const acc = this._mat(cfg.accentColor);
    const can = this._mat(0x99BBDD);

    // Very slim fuselage (teardrop)
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.18, 7.5, 8), mat);
    fuse.rotation.x = Math.PI / 2;
    g.add(fuse);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.8, 8), mat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -4.65;
    g.add(nose);

    // Very long high-AR wings (span ~15m scale)
    const wingSpan = 12;
    const wingGeo = new THREE.BoxGeometry(wingSpan, 0.08, 1.2);
    const wing = new THREE.Mesh(wingGeo, mat);
    wing.position.y = 0.05;
    g.add(wing);

    // Wing accent
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(wingSpan * 0.9, 0.1, 0.2), acc);
    stripe.position.y = 0.06;
    g.add(stripe);

    // Wing tips (slight upward dihedral)
    [-1, 1].forEach(side => {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.07, 0.8), mat);
      tip.position.set(side * (wingSpan / 2 + 0.6), 0.3, 0);
      tip.rotation.z = side * 0.3;
      g.add(tip);
    });

    // T-tail (distinctive glider feature)
    const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.9), mat);
    vStab.position.set(0, 0.8, 4.5);
    g.add(vStab);
    const hStab = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.08, 0.7), mat);
    hStab.position.set(0, 1.55, 4.5);
    g.add(hStab);

    // Canopy
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.45), can);
    canopy.position.set(0, 0.28, -0.5);
    g.add(canopy);

    this._applyShading(g);
    return g;
  }

  // ── Pitts Special (Stunt Biplane) ─────────────────────────
  static _createStunt(cfg) {
    const g   = new THREE.Group();
    const mat = this._mat(cfg.color);
    const acc = this._mat(cfg.accentColor);
    const dk  = this._mat(0x111111);
    const can = this._mat(0x88AACC);

    // Short stubby fuselage
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.32, 5.0, 8), mat);
    fuse.rotation.x = Math.PI / 2;
    g.add(fuse);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.0, 8), mat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -3.0;
    g.add(nose);

    // Upper wing
    const upperWing = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.11, 1.1), acc);
    upperWing.position.set(0, 0.8, 0.1);
    g.add(upperWing);

    // Lower wing (shorter)
    const lowerWing = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.11, 1.0), mat);
    lowerWing.position.set(0, -0.3, 0.2);
    g.add(lowerWing);

    // Wing struts
    [-1.5, 1.5].forEach(x => {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 5), dk);
      strut.position.set(x, 0.25, 0.15);
      g.add(strut);
    });

    // Open cockpit (no canopy)
    const cockpitRim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 5, 12), dk);
    cockpitRim.position.set(0, 0.48, -0.5);
    g.add(cockpitRim);

    // H-tail
    const hStab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.09, 0.7), mat);
    hStab.position.set(0, 0, 2.9);
    g.add(hStab);
    const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.8, 0.85), mat);
    vStab.position.set(0, 0.4, 2.8);
    g.add(vStab);

    // Radial engine cowl
    const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.5, 0.5, 10), dk);
    cowl.rotation.x = Math.PI / 2;
    cowl.position.z = -2.55;
    g.add(cowl);

    // Propeller
    const propGroup = new THREE.Group();
    propGroup.name = 'propeller';
    propGroup.position.z = -2.9;
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.04), dk);
      blade.position.y = 0.48;
      blade.rotation.z = (i / 3) * Math.PI * 2;
      propGroup.add(blade);
    }
    g.add(propGroup);

    // Fixed landing gear (biplane style)
    [-0.9, 0.9].forEach(x => {
      const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 5), dk);
      gear.position.set(x, -0.55, 0.5);
      g.add(gear);
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 5), dk);
      axle.rotation.z = Math.PI / 2;
      axle.position.set(0, -0.8, 0.5);
      g.add(axle);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.065, 5, 12), dk);
      wheel.position.set(x, -0.8, 0.5);
      wheel.rotation.y = Math.PI / 2;
      g.add(wheel);
    });

    this._applyShading(g);
    return g;
  }

  // ── C-130 Hercules (Cargo) ─────────────────────────────────
  static _createCargo(cfg) {
    const g   = new THREE.Group();
    const mat = this._mat(cfg.color);
    const acc = this._mat(cfg.accentColor);
    const dk  = this._mat(0x222222);
    const eng = this._mat(0x333333);

    // Very large boxy fuselage
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.3, 14, 10), mat);
    fuse.rotation.x = Math.PI / 2;
    g.add(fuse);

    // Rounded nose
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), mat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -7.0;
    g.add(nose);

    // Cargo ramp tail
    const tailBoom = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.5, 4.5, 8), mat);
    tailBoom.rotation.x = Math.PI / 2;
    tailBoom.position.z = 9.0;
    tailBoom.rotation.y = 0;
    g.add(tailBoom);

    // High-mounted wings
    const wingGeo = new THREE.BoxGeometry(18, 0.18, 2.6);
    const wing = new THREE.Mesh(wingGeo, mat);
    wing.position.set(0, 1.0, 0.5);
    g.add(wing);

    // Wing highlight
    const wingHL = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 0.4), acc);
    wingHL.position.set(0, 1.02, 0.3);
    g.add(wingHL);

    // 4x turboprop engines
    [-3.5, -1.4, 1.4, 3.5].forEach((x, i) => {
      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 2.8, 8), eng);
      nacelle.rotation.x = Math.PI / 2;
      nacelle.position.set(x, 0.85, 0.0);
      g.add(nacelle);

      const propGroup = new THREE.Group();
      propGroup.name = i === 0 ? 'propeller' : `propeller_${i}`;
      propGroup.position.set(x, 0.85, -1.55);
      for (let b = 0; b < 4; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.1, 0.05), dk);
        blade.position.y = 0.52;
        blade.rotation.z = (b / 4) * Math.PI * 2;
        propGroup.add(blade);
      }
      g.add(propGroup);
    });

    // H-tail (large)
    const hStab = new THREE.Mesh(new THREE.BoxGeometry(9, 0.14, 1.8), mat);
    hStab.position.set(0, 0.5, 11.5);
    g.add(hStab);
    const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.2, 2.5), mat);
    vStab.position.set(0, 2.1, 10.8);
    g.add(vStab);

    // Main gear (large)
    [-2.0, 2.0].forEach(x => {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 5), dk);
      strut.position.set(x, -1.6, 1.5);
      g.add(strut);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.16, 6, 14), dk);
      wheel.position.set(x, -2.15, 1.5);
      wheel.rotation.y = Math.PI / 2;
      g.add(wheel);
    });

    this._applyShading(g);
    return g;
  }

  static _createMustang(cfg) {
    const g = new THREE.Group();
    const mat = this._glossMat(cfg.color);
    const acc = this._glossMat(cfg.accentColor);
    const dark = this._mat(0x1f2328, false);

    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.34, 7.8, 10), mat);
    fuselage.rotation.x = Math.PI / 2;
    g.add(fuselage);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.8, 10), mat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -4.7;
    g.add(nose);

    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.48, 12, 8), this._glossMat(0x89a5bf));
    canopy.scale.set(0.9, 0.55, 1.45);
    canopy.position.set(0, 0.42, -0.3);
    g.add(canopy);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.14, 1.9), mat);
    wing.position.set(0, -0.04, 0.08);
    g.add(wing);

    const wingStripe = new THREE.Mesh(new THREE.BoxGeometry(10.1, 0.05, 0.38), acc);
    wingStripe.position.set(0, 0.03, -0.28);
    g.add(wingStripe);

    const tailPlane = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.1, 0.9), mat);
    tailPlane.position.set(0, 0.1, 3.05);
    g.add(tailPlane);

    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.35, 1.15), mat);
    fin.position.set(0, 0.72, 2.82);
    g.add(fin);

    const propHub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.25, 10), dark);
    propHub.rotation.x = Math.PI / 2;
    propHub.position.z = -5.18;
    g.add(propHub);

    const propGroup = new THREE.Group();
    propGroup.name = 'propeller';
    propGroup.position.z = -5.28;
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.35, 0.05), dark);
      blade.position.y = 0.66;
      blade.rotation.z = (i / 4) * Math.PI * 2;
      propGroup.add(blade);
    }
    g.add(propGroup);

    this._applyShading(g);
    return g;
  }

  static _createConcorde(cfg) {
    const g = new THREE.Group();
    const mat = this._glossMat(cfg.color);
    const accent = this._mat(cfg.accentColor, false);
    const dark = this._mat(0x243447, false);

    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.38, 16.5, 12), mat);
    fuselage.rotation.x = Math.PI / 2;
    g.add(fuselage);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.44, 4.2, 10), mat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -10.2;
    g.add(nose);

    const deltaWing = new THREE.Mesh(new THREE.BoxGeometry(14.5, 0.14, 4.5), mat);
    deltaWing.scale.set(1, 1, 0.7);
    deltaWing.position.set(0, -0.04, 0.45);
    g.add(deltaWing);

    const intakeLeft = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.52, 4.8), dark);
    intakeLeft.position.set(-1.55, -0.42, 1.2);
    const intakeRight = intakeLeft.clone();
    intakeRight.position.x *= -1;
    g.add(intakeLeft, intakeRight);

    const tailPlane = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 0.7), mat);
    tailPlane.position.set(0, 0.08, 6.0);
    g.add(tailPlane);

    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.15, 2.2), mat);
    fin.position.set(0, 1.1, 5.65);
    g.add(fin);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 11.8), accent);
    stripe.position.set(0, 0.22, -0.6);
    g.add(stripe);

    this._applyShading(g);
    return g;
  }

  static _createBlackbird(cfg) {
    const g = new THREE.Group();
    const mat = this._glossMat(cfg.color);
    const accent = this._glossMat(cfg.accentColor);
    const dark = this._mat(0x090c10, false);

    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.42, 14.5, 12), mat);
    fuselage.rotation.x = Math.PI / 2;
    g.add(fuselage);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 3.8, 12), mat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -9.1;
    g.add(nose);

    const chineLeft = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 7.4), mat);
    chineLeft.position.set(-1.65, 0.06, -1.0);
    chineLeft.rotation.y = -0.22;
    const chineRight = chineLeft.clone();
    chineRight.position.x *= -1;
    chineRight.rotation.y *= -1;
    g.add(chineLeft, chineRight);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.16, 2.8), mat);
    wing.position.set(0, -0.08, 1.0);
    g.add(wing);

    const nacelleLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.38, 5.8, 8), dark);
    nacelleLeft.rotation.x = Math.PI / 2;
    nacelleLeft.position.set(-2.25, -0.35, 0.95);
    const nacelleRight = nacelleLeft.clone();
    nacelleRight.position.x *= -1;
    g.add(nacelleLeft, nacelleRight);

    const finLeft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.95, 1.7), mat);
    finLeft.position.set(-0.82, 1.02, 4.55);
    finLeft.rotation.z = -0.12;
    const finRight = finLeft.clone();
    finRight.position.x *= -1;
    finRight.rotation.z *= -1;
    g.add(finLeft, finRight);

    const tailPlane = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.08, 0.88), mat);
    tailPlane.position.set(0, 0.02, 5.25);
    g.add(tailPlane);

    const accentLine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 8.2), accent);
    accentLine.position.set(0, 0.18, -0.4);
    g.add(accentLine);

    this._applyShading(g);
    return g;
  }
}
