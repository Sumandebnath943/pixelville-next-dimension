/* ============================================================
   The surface patch: one onBeforeCompile injection that every
   V2 standard material goes through. It adds
   - world-space anti-tiling (large stains and colour drift),
   - wetness (darker, glossier), puddles with rain ripples and a
     planar reflection of the street,
   - snow that settles on upward faces, breaks up with noise as
     it thins, is cleared by tyres and feet (wear mask) and
     sparkles in the sun,
   - height fog that is warmer towards the sun,
   - optional hooks so foliage and windows can add wind sway or
     lit interiors without losing the weather.
   ============================================================ */
import * as THREE from 'three';
import { ENV, GLSL_COMMON, MAX_BEAMS, bindEnv } from './env';

export interface SurfaceOpts {
  /** how readily snow settles here (0 never … 1 fully) */
  snow?: number;
  /** how much rain darkens the surface (porous ≈ 1, glazed ≈ 0.3) */
  wet?: number;
  /** flat paving that collects puddles and reflects the street */
  puddles?: boolean;
  /** read the traffic-wear mask (tyre tracks, footpaths, kerb piles) */
  wear?: boolean;
  /** V2: where there's no wear mask (the game's streets), how well the snow is cleared off it (roads ≈ 0.85: grey
   *  slush instead of a white carriageway; pavements less) */
  plough?: number;
  /** V2: grass that comes out of the snow flattened and straw-pale (0 … 1) */
  thaw?: number;
  /** strength of large-scale colour variation */
  antiTile?: number;
  /** V2: natural ground with no straight lines (grass, sand, rock, gravel): its texture is sampled twice, the second
   *  turned and scaled, so its repeat doesn't show from above */
  antiTex?: boolean;
  /** GLSL declarations for the vertex shader */
  vDecl?: string;
  /** GLSL run after begin_vertex; may modify `transformed` (object space) */
  vDisplace?: string;
  /** GLSL declarations for the fragment shader */
  fDecl?: string;
  /** GLSL run after color_fragment (diffuseColor available) */
  fColor?: string;
  /** GLSL run after emissivemap_fragment (add to totalEmissiveRadiance) */
  fEmissive?: string;
  /** extra uniforms */
  uniforms?: Record<string, THREE.IUniform>;
  /** double-sided foliage: don't flip normals on back faces */
  keepNormals?: boolean;
  /** V2: thin blades and leaves: the headlamps light them evenly, through and through, with no glints */
  softBeam?: boolean;
}

const RIPPLE = /* glsl */ `
vec2 pvRipple(vec2 p, float t) {
  vec2 acc = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p * (2.4 + float(k) * 1.7) + float(k) * 7.31;
    vec2 cell = floor(q), f = fract(q);
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(float(i), float(j));
        vec2 h = pvHash22(c + float(k) * 13.0);
        vec2 dv = (vec2(float(i), float(j)) + h) - f;
        float ph = fract(t * (0.8 + h.x * 0.5) + h.y);
        float x = length(dv) - ph;
        float ring = sin(x * 26.0) * smoothstep(0.14, 0.0, abs(x)) * (1.0 - ph) * (1.0 - ph);
        acc += ring * normalize(dv + 1e-4);
      }
  }
  return acc * 0.5;
}
`;

/* V2: headlamps light whatever is in front of them (road, kerb, wall, people, the car ahead) with its own colour and
   gloss, as a dipped beam does: cut off flat on the oncoming side and kicked up on the kerb side, most of the light
   thrown far down the road and little just before the bonnet, spread wide near the car. The lamps are summed into
   one light (their directions weighted by how much each brings: exact for the diffuse part), so the full lighting
   model runs once, not once per lamp: the shader stays small and quick to compile. */
const BEAMS = /* glsl */ `
{
  vec3 pvBeam = vec3(0.0);
  for (int i = 0; i < ${MAX_BEAMS}; i++) {
    if (i >= uBeamN) break;
    vec3 bd = vWPos - uBeamP[i].xyz;
    vec3 bf = uBeamF[i].xyz, br = uBeamR[i].xyz;
    float bz = dot(bd, bf), bdd = dot(bd, bd);
    if (bz < 0.15 || bdd > 4900.0) continue;
    // across the beam (+ towards the kerb), from a little behind the lamps: the two of them already light the
    // width of the car just ahead of it
    float bh = dot(bd, br) / (bz + 1.5);
    float bs = -dot(bd, cross(br, bf)) / bz;    // + below the lamps
    float bcut = 0.006 - 0.032 * smoothstep(0.03, 0.3, bh);
    float bI = smoothstep(bcut - 0.004, bcut + 0.014, bs);
    bI *= pow(0.02 / max(bs, 0.02), 2.3) * (1.0 - smoothstep(0.1, 0.4, bs));
    // wide just ahead, narrowing far down the road
    float bc = bh - 0.03;
    bI *= 0.78 * exp(-bc * bc * 12.0) + 0.22 * exp(-bh * bh * mix(1.8, 6.0, 1.0 - smoothstep(0.025, 0.08, bs)));
    bI *= uBeamP[i].w * smoothstep(0.15, 1.0, bz) * (1.0 - smoothstep(2500.0, 4900.0, bdd)) / max(bdd, 0.25);
    vec3 bl = -bd * inversesqrt(max(bdd, 1e-4));
    // what squarely faces the lamps (the back of the car ahead, a wall) is lit brightly, but eased off before it
    // burns out white
    float bn = max(dot(pvN, bl), 0.0) * bI;
    pvBeam += bl * (bI / (1.0 + bn / 2.0));
  }
  float pvBeamE = length(pvBeam);
  #ifdef PV_SOFTBEAM
  // (V2: grass blades and leaf cards face every which way: lit blade by blade, each one turned to the lamps flared
  // and glinted far brighter than the ground they stand on, which the beam only grazes, and the beam's pool on a
  // verge or under a tree glittered like confetti. Lit evenly instead, about as the ground beneath them is)
  if (pvBeamE > 1e-4) {
    float pvBeamK = max(normalize(pvBeam).y, 0.0) * 0.9 + 0.06;
    reflectedLight.directDiffuse += BRDF_Lambert(material.diffuseColor) * vec3(1.0, 0.94, 0.84) * pvBeamE * pvBeamK;
  }
  #else
  if (pvBeamE > 1e-4) {
    IncidentLight beam;
    beam.direction = normalize((viewMatrix * vec4(pvBeam, 0.0)).xyz);
    beam.color = vec3(1.0, 0.94, 0.84) * pvBeamE;
    beam.visible = true;
    // (dry tarmac facing oncoming lamps would mirror them back almost white: rough surfaces keep only a sheen of
    // that; a wet road, a puddle or paint keeps all of its shine)
    ReflectedLight pvBR = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
    RE_Direct(beam, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, pvBR);
    reflectedLight.directDiffuse += pvBR.directDiffuse;
    reflectedLight.directSpecular += pvBR.directSpecular * mix(1.0, 0.2, smoothstep(0.35, 0.8, material.roughness));
  }
  #endif
}
`;

export function surface(mat: THREE.MeshStandardMaterial, o: SurfaceOpts = {}, key = ''): THREE.MeshStandardMaterial {
  const snowK = o.snow ?? 0;
  const wetK = o.wet ?? 0.6;
  // only structural switches are defines; strengths are uniforms so materials share programs
  const defs: string[] = [];
  if (snowK > 0) defs.push('#define PV_SNOW');
  if (o.puddles) defs.push('#define PV_PUDDLES');
  if (o.wear) defs.push('#define PV_WEAR');
  if (o.antiTile) defs.push('#define PV_ANTITILE');
  if (o.antiTex) defs.push('#define PV_ANTITEX');
  if (o.softBeam) defs.push('#define PV_SOFTBEAM');
  const head = defs.join('\n') + '\n';
  const hooked = !!(o.vDecl || o.vDisplace || o.fDecl || o.fColor || o.fEmissive || o.keepNormals);
  const strengths = { uSnowK: { value: snowK }, uWetK: { value: wetK }, uAntiK: { value: o.antiTile ?? 0 }, uPloughK: { value: o.plough ?? 0 }, uThawK: { value: o.thaw ?? 0 } };

  mat.onBeforeCompile = (sh) => {
    bindEnv(sh.uniforms);
    Object.assign(sh.uniforms, strengths);
    sh.uniforms.uReflTex = ENV.reflTex;
    sh.uniforms.uReflMat = ENV.reflMat;
    sh.uniforms.uReflOn = ENV.reflOn;
    sh.uniforms.uWearTex = ENV.wearTex;
    sh.uniforms.uWearRect = ENV.wearRect;
    sh.uniforms.uBeamN = ENV.beamN;
    sh.uniforms.uBeamP = ENV.beamP;
    sh.uniforms.uBeamF = ENV.beamF;
    sh.uniforms.uBeamR = ENV.beamR;
    if (o.uniforms) Object.assign(sh.uniforms, o.uniforms);

    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${head}${GLSL_COMMON}\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n${o.vDecl || ''}`)
      .replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>
        {
          vec3 wn = objectNormal;
          #ifdef USE_INSTANCING
            wn = mat3(instanceMatrix) * wn;
          #endif
          vWNrm = normalize(mat3(modelMatrix) * wn);
        }`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${o.vDisplace || ''}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vWPos = (modelMatrix * wp).xyz;
        }`,
      );

    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${head}${GLSL_COMMON}
        #ifdef PV_PUDDLES
        ${RIPPLE}
        #endif
        varying vec3 vWPos;
        varying vec3 vWNrm;
        uniform float uSnowK;
        uniform float uWetK;
        uniform float uAntiK;
        uniform float uPloughK;
        uniform float uThawK;
        uniform sampler2D uReflTex;
        uniform mat4 uReflMat;
        uniform float uReflOn;
        uniform sampler2D uWearTex;
        uniform vec4 uWearRect;
        uniform int uBeamN;
        uniform vec4 uBeamP[${MAX_BEAMS}];
        uniform vec4 uBeamF[${MAX_BEAMS}];
        uniform vec4 uBeamR[${MAX_BEAMS}];
        ${o.fDecl || ''}`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D(map, vMapUv);
          #ifdef PV_ANTITEX
          {
            // V2: a second look at the same texture, turned and scaled, mixed in by a slow world-space noise: its repeat
            // (an 8 m grid of the same dry patches over every lawn, plain from the Planner) no longer shows
            float pvK2 = smoothstep(0.32, 0.68, pvNoise(vWPos.xz * 0.019 + 1.3)) * 0.85;
            vec2 pvUv2 = mat2(0.799, -0.602, 0.602, 0.799) * vMapUv * 0.618 + vec2(0.37, 0.71);
            sampledDiffuseColor = mix(sampledDiffuseColor, texture2D(map, pvUv2), pvK2);
          }
          #endif
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 pvN = normalize(vWNrm);
        float pvUp = pvN.y;
        #ifdef PV_ANTITILE
          float pvAT = pvFbm(vWPos.xz * 0.045) * 0.7 + pvFbm(vWPos.xz * 0.23) * 0.3;
          diffuseColor.rgb *= mix(1.0 - uAntiK, 1.0 + uAntiK * 0.5, pvAT);
        #endif
        ${o.fColor || ''}
        vec2 pvWear = vec2(0.0);
        float pvWorn = 0.0; // (1 inside the wear mask: the look lab's street; the game's streets are ploughed instead)
        #ifdef PV_WEAR
          vec2 pvWuv = (vWPos.xz - uWearRect.xy) * uWearRect.zw;
          if (pvWuv.x > 0.0 && pvWuv.x < 1.0 && pvWuv.y > 0.0 && pvWuv.y < 1.0) { pvWear = texture2D(uWearTex, pvWuv).rg; pvWorn = 1.0; }
        #endif
        float pvSnow = 0.0;
        float pvSlush = 0.0;
        float pvMeltWet = 0.0;
        float pvField = 0.5;
        #ifdef PV_SNOW
        {
          // V2: drifts that thaw from their edges in (env.ts pvSnowCover), wet ground round them, ploughed streets
          float plough = uPloughK * (1.0 - pvWorn);
          float cov = uSnow * uSnowK * (1.0 - plough * 0.8);
          float up = smoothstep(0.25, 0.95, pvUp);
          pvField = pvSnowField(vWPos.xz + vWPos.y * 0.3) - (1.0 - up) * 0.3;
          float t = pvSnowLine(cov);
          float drift = smoothstep(t - 0.02, t + 0.02, pvField) * mix(0.62, 1.0, smoothstep(t, t + 0.14, pvField)) * smoothstep(0.0, 0.05, cov);
          float dust = smoothstep(0.0, 0.55, cov) * (1.0 - uMelt) * (0.82 + 0.18 * pvNoise(vWPos.xz * 3.0)) * up;
          pvSnow = max(drift, dust * 0.9) * step(0.3, pvUp);
          pvMeltWet = uMelt * smoothstep(0.02, 0.25, cov) * smoothstep(t - 0.16, t - 0.01, pvField) * (1.0 - pvSnow) * step(0.3, pvUp);
          pvSlush = max(pvWear.r * smoothstep(0.03, 0.35, uSnow) * uSnowK, plough * smoothstep(0.02, 0.3, uSnow) * uSnowK * step(0.6, pvUp));
          pvSnow *= 1.0 - pvWear.r * 0.9;
          pvSnow = max(pvSnow, pvWear.g * smoothstep(0.08, 0.45, uSnow) * step(0.3, pvUp));
        }
        #endif
        float pvPud = 0.0;
        #ifdef PV_PUDDLES
          pvPud = smoothstep(0.64 - uWet * 0.08, 0.68 - uWet * 0.08, pvFbm(vWPos.xz * 0.16 + 3.1) + pvWear.r * 0.05)
                * step(0.92, pvUp) * smoothstep(0.35, 0.9, uWet) * (1.0 - pvSnow);
        #endif
        float pvWet = max(max(uWet * uWetK * mix(0.45, 1.0, smoothstep(0.1, 0.8, abs(pvUp))), pvSlush), pvMeltWet * 0.85) * (1.0 - pvSnow);
        // V2: grass out from under the snow comes up flattened and straw-pale, and greens again over a day or two
        float pvMat = uThaw * uThawK * (1.0 - pvSnow) * (0.55 + 0.45 * smoothstep(0.3, 0.6, pvField));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))) * vec3(1.3, 1.08, 0.62), pvMat * 0.7);
        diffuseColor.rgb *= mix(1.0, 0.5, pvWet);
        diffuseColor.rgb *= mix(1.0, 0.55, pvPud);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.19, 0.17), pvSlush * 0.55 * (1.0 - pvSnow));
        // (old snow greys as it thaws)
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.86, 0.89, 0.94), vec3(0.75, 0.77, 0.79), uMelt * 0.6) * (0.92 + 0.08 * pvNoise(vWPos.xz * 9.0)), pvSnow);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.32), pvWet);
        roughnessFactor = mix(roughnessFactor, 0.025, pvPud);
        roughnessFactor = mix(roughnessFactor, 0.6, pvSnow);
        #ifdef PV_SOFTBEAM
        roughnessFactor = mix(roughnessFactor, 1.0, uNight); // (and no glints after dark)
        #endif`,
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - pvSnow;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        ${o.keepNormals ? '#ifdef DOUBLE_SIDED\nnormal *= faceDirection;\n#endif' : ''}
        {
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          #ifdef PV_SOFTBEAM
          // (V2: leaf cards and blades, each turned its own way and swaying, were lit one by one by the moon and the
          // street lamps and glittered cyan and yellow through the night: after dark they take the light as a whole,
          // as the crown or the meadow does, towards the sky)
          normal = normalize(mix(normal, upV, uNight * 0.85));
          #endif
          normal = normalize(mix(normal, upV, max(pvSnow * 0.75, pvPud)));
          #ifdef PV_PUDDLES
          if (uRain > 0.01 && pvUp > 0.9) {
            vec2 rp = pvRipple(vWPos.xz, uTime) * uRain * (pvPud * 0.45 + pvWet * 0.12);
            vec3 nW = normalize(vec3(-rp.x, 1.0, -rp.y));
            vec3 nV = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
            normal = normalize(normal + (nV - upV));
          }
          #endif
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #ifdef PV_SNOW
        if (pvSnow > 0.01) {
          vec3 cp = floor(vWPos * 70.0);
          vec2 hh = pvHash22(cp.xz + cp.y * 17.0);
          vec3 rn = normalize(vec3(hh.x - 0.5, 0.55, hh.y - 0.5));
          vec3 vd = normalize(cameraPosition - vWPos);
          float g = pow(max(dot(rn, normalize(vd + uSunDir)), 0.0), 260.0) * step(0.8, pvHash12(cp.xz * 1.37 + cp.y));
          totalEmissiveRadiance += uSunColor * g * pvSnow * 0.5;
        }
        #endif
        ${o.fEmissive || ''}`,
      )
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${BEAMS}`)
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
        #if defined(PV_PUDDLES) && defined(USE_ENVMAP)
        if (uReflOn > 0.5 && pvUp > 0.9) {
          vec4 rp = uReflMat * vec4(vWPos, 1.0);
          vec2 ruv = rp.xy / rp.w;
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          ruv += (normal.xy - upV.xy) * 0.08;
          float lod = material.roughness * 7.0;
          vec3 rc = vec3(0.0);
          for (int i = 0; i < 4; i++) rc += textureLod(uReflTex, ruv + vec2(0.0, (float(i) - 1.5) * material.roughness * 0.03), lod).rgb;
          rc *= 0.25;
          float rk = clamp(1.0 - material.roughness * 2.6, 0.0, 1.0) * max(pvWet, pvPud);
          radiance = mix(radiance, rc, rk);
        }
        #endif`,
      )
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = pvFog(gl_FragColor.rgb, vWPos);');
  };
  mat.customProgramCacheKey = () => `pv|${head}|${hooked ? key : ''}`;
  return mat;
}

/** apply only the V2 fog to an unlit material (glows, lamps) */
export function fogOnly(mat: THREE.Material, key = ''): THREE.Material {
  mat.onBeforeCompile = (sh) => {
    bindEnv(sh.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vWPos = (modelMatrix * wp).xyz;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\nvarying vec3 vWPos;`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = pvFog(gl_FragColor.rgb, vWPos);');
  };
  mat.customProgramCacheKey = () => 'pvfog|' + key;
  return mat;
}
