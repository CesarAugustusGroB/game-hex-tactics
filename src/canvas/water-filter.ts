import * as PIXI from 'pixi.js';

export interface WaterFilterConfig {
  strength: number;
  speed: number;
  frequency: number;
  drift: number;
}

export interface WaterFilterHandle {
  filter: PIXI.Filter;
  uniforms: { uTime: number };
  /** Set once when cached so `drawTerrain` can reuse the handle across redraws. */
  kind?: 'deepSea' | 'coastal';
}

export const WATER_FILTER_CONFIGS: Record<'deepSea' | 'coastal', WaterFilterConfig> = {
  deepSea: {
    strength: 0.0025,
    speed: 0.18,
    frequency: 7.0,
    drift: 0.35,
  },
  coastal: {
    strength: 0.004,
    speed: 0.32,
    frequency: 10.0,
    drift: 0.55,
  },
};

// PIXI v8 auto-binds uInputSize / uOutputFrame / uOutputTexture into every filter; the
// vertex shader must use them to map the [0,1] aPosition quad into the filter's allocated
// region of the framebuffer atlas. A naïve `aPosition * 2 - 1` ignores those uniforms,
// stretching the quad to the full viewport and sampling the input texture from corner to
// corner — which yields a flat-color rectangle wherever the filtered container actually
// lives. This shader matches PIXI's canonical passthrough.vert (see node_modules/pixi.js
// filters/defaults/passthrough/passthrough.vert.mjs).
export const WATER_FILTER_VERTEX = `
  in vec2 aPosition;
  out vec2 vTextureCoord;

  uniform vec4 uInputSize;
  uniform vec4 uOutputFrame;
  uniform vec4 uOutputTexture;

  vec4 filterVertexPosition() {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
  }

  vec2 filterTextureCoord() {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
  }

  void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
  }
`;

export const WATER_FILTER_FRAGMENT = `
  in vec2 vTextureCoord;

  uniform sampler2D uTexture;
  uniform float uTime;
  uniform float uStrength;
  uniform float uSpeed;
  uniform float uFrequency;
  uniform float uDrift;

  void main(void) {
    vec2 coord = vTextureCoord;
    float t = uTime * uSpeed;
    float waveA = sin((coord.y + t * uDrift) * uFrequency + t);
    float waveB = sin((coord.x - t * 0.37) * (uFrequency * 0.73) - t * 0.8);
    coord.x += waveA * uStrength;
    coord.y += waveB * uStrength * 0.6;
    gl_FragColor = texture(uTexture, coord);
  }
`;

export const createWaterFilter = (config: WaterFilterConfig): WaterFilterHandle => {
  const filter = new PIXI.Filter({
    glProgram: new PIXI.GlProgram({
      vertex: WATER_FILTER_VERTEX,
      fragment: WATER_FILTER_FRAGMENT,
    }),
    resources: {
      waterUniforms: {
        uTime: { value: 0, type: 'f32' },
        uStrength: { value: config.strength, type: 'f32' },
        uSpeed: { value: config.speed, type: 'f32' },
        uFrequency: { value: config.frequency, type: 'f32' },
        uDrift: { value: config.drift, type: 'f32' },
      },
    },
    padding: 2,
  });
  const uniforms = (filter.resources.waterUniforms as { uniforms: { uTime: number } }).uniforms;
  return { filter, uniforms };
};
