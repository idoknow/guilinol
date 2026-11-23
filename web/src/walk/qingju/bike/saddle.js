/**
 * saddle.js — quilted vinyl saddle, black base shell, piping and the
 * "已消毒" cleanliness label, plus the seat lock and hinge details.
 */
import * as THREE from 'three';
import {
  loftSectionsZ, meshOf, decalGeometry, sideURange, setShadowFlags, roundedBoxGeometry,
  tubeFromPoints, makeLoft, clamp,
} from '../util/geom.js';
import * as T from '../util/textures.js';

const { PI } = Math;

export function buildSaddle(mats) {
  const group = new THREE.Group();
  group.name = 'saddle';
  const parts = {};

  /* black base shell — a skirt that wraps the body's top so the saddle sits
     flush with no visible gap */
  const base = loftSectionsZ([
    { z: -0.196, y0: 0.548, y1: 0.700, w: 0.246, rT: 0.030, rB: 0.040 },
    { z: -0.232, y0: 0.580, y1: 0.706, w: 0.268, rT: 0.026, rB: 0.034 },
    { z: -0.300, y0: 0.604, y1: 0.710, w: 0.278, rT: 0.028, rB: 0.030 },
    { z: -0.400, y0: 0.608, y1: 0.712, w: 0.280, rT: 0.028, rB: 0.030 },
    { z: -0.500, y0: 0.616, y1: 0.711, w: 0.272, rT: 0.028, rB: 0.030 },
    { z: -0.570, y0: 0.638, y1: 0.707, w: 0.248, rT: 0.028, rB: 0.030 },
    { z: -0.640, y0: 0.652, y1: 0.702, w: 0.206, rT: 0.028, rB: 0.030 },
    { z: -0.700, y0: 0.666, y1: 0.694, w: 0.146, rT: 0.026, rB: 0.028 },
  ], { segments: 34, edgeSegs: 7, cornerSegs: 9 });
  group.add(meshOf(base.geometry, mats.plasticSoft));
  parts.base = base;

  /* the saddle itself — its underside is seated 6 mm inside the base skirt */
  const seatSections = [
    { z: -0.126, y0: 0.700, y1: 0.742, w: 0.124, rT: 0.018, rB: 0.016 },
    { z: -0.160, y0: 0.694, y1: 0.757, w: 0.182, rT: 0.028, rB: 0.016 },
    { z: -0.210, y0: 0.688, y1: 0.769, w: 0.230, rT: 0.036, rB: 0.016 },
    { z: -0.280, y0: 0.684, y1: 0.778, w: 0.259, rT: 0.040, rB: 0.016 },
    { z: -0.360, y0: 0.683, y1: 0.782, w: 0.271, rT: 0.042, rB: 0.016 },
    { z: -0.440, y0: 0.686, y1: 0.780, w: 0.265, rT: 0.042, rB: 0.016 },
    { z: -0.510, y0: 0.696, y1: 0.774, w: 0.245, rT: 0.040, rB: 0.016 },
    { z: -0.570, y0: 0.712, y1: 0.765, w: 0.209, rT: 0.036, rB: 0.016 },
    { z: -0.612, y0: 0.728, y1: 0.751, w: 0.151, rT: 0.026, rB: 0.016 },
  ];
  const seat = loftSectionsZ(seatSections, { segments: 56, edgeSegs: 8, cornerSegs: 11 });
  group.add(meshOf(seat.geometry, mats.seatLeather));
  parts.seat = seat;

  /* quilted cover over the top */
  {
    const ur = sideURange(seat, 0.5, 1, 0.60, 'y');
    const dec = decalGeometry(seat, {
      u0: ur[0] + 0.016, u1: ur[1] - 0.016, v0: 0.055, v1: 0.945,
      offset: 0.0018, project: 'xz', uSegs: 34, vSegs: 46,
    });
    const cover = new THREE.Mesh(dec.geometry, mats.seatQuilt);
    cover.castShadow = false;
    cover.receiveShadow = true;
    group.add(cover);
    parts.cover = cover;

    // piping around the cover edge
    const ring = [];
    const steps = 26;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      ring.push(seat.point(ur[0] + 0.016 + (ur[1] - ur[0] - 0.032) * t, 0.055));
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      ring.push(seat.point(ur[0] + 0.016 + (ur[1] - ur[0] - 0.032) * t, 0.945));
    }
    const piping = tubeFromPoints(ring, 0.0042, { radialSegs: 7, tubularSegs: 110, closed: true, tension: 0.2 });
    group.add(meshOf(piping, mats.plasticSoft));
  }

  /* cleanliness label on the nose of the saddle */
  {
    const dec = decalGeometry(seat, {
      u0: 0.435, u1: 0.565, v0: 0.115, v1: 0.255,
      offset: 0.0024, project: 'xz', uSegs: 10, vSegs: 8,
    });
    const tex = T.makeSeatSticker(dec.size.x, dec.size.y);
    const label = new THREE.Mesh(dec.geometry, mats.decal(tex, { roughness: 0.72, metalness: 0.0 }));
    label.castShadow = false;
    group.add(label);
    parts.label = label;
  }

  /* seat lock + hinge plates */
  {
    const lockBody = meshOf(roundedBoxGeometry(0.036, 0.026, 0.030, 0.008, { segments: 8 }), mats.blackMetal);
    lockBody.position.set(0.118, 0.700, -0.520);
    group.add(lockBody);
    const keyhole = meshOf(new THREE.CylinderGeometry(0.0075, 0.0075, 0.006, 14), mats.steel);
    keyhole.position.set(0.118, 0.714, -0.520);
    group.add(keyhole);
    for (const s of [1, -1]) {
      const hinge = meshOf(roundedBoxGeometry(0.020, 0.030, 0.048, 0.006, { segments: 6 }), mats.blackMetal);
      hinge.position.set(s * 0.132, 0.700, -0.215);
      group.add(hinge);
    }
  }

  setShadowFlags(group);
  return { group, parts };
}
