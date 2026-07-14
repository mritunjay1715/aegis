/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// tslint:disable:organize-imports
// tslint:disable:ban-malformed-import-paths
// tslint:disable:no-new-decorators

import {LitElement, css, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {Analyser} from './analyser';

import * as THREE from 'three';
import {EXRLoader} from 'three/addons/loaders/EXRLoader.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';
import {fs as backdropFS, vs as backdropVS} from './backdrop-shader';
import {vs as sphereVS} from './sphere-shader';

/**
 * 3D live audio visual.
 */
@customElement('gdm-live-audio-visuals-3d')
export class GdmLiveAudioVisuals3D extends LitElement {
  @property({type: String})
  aegisState: 'STANDBY' | 'LISTENING' | 'THINKING' | 'SPEAKING' = 'STANDBY';

  private inputAnalyser!: Analyser;
  private outputAnalyser!: Analyser;
  private camera!: THREE.PerspectiveCamera;
  private backdrop!: THREE.Mesh;
  private composer!: EffectComposer;
  private sphere!: THREE.Mesh;
  private prevTime = 0;
  private rotation = new THREE.Vector3(0, 0, 0);
  
  private rings: THREE.Mesh[] = [];
  private ringMaterials: THREE.MeshBasicMaterial[] = [];
  private speakingTransition = 0;

  private _outputNode!: AudioNode;

  @property()
  set outputNode(node: AudioNode) {
    this._outputNode = node;
    this.outputAnalyser = new Analyser(this._outputNode);
  }

  get outputNode() {
    return this._outputNode;
  }

  private _inputNode!: AudioNode;

  @property()
  set inputNode(node: AudioNode) {
    this._inputNode = node;
    this.inputAnalyser = new Analyser(this._inputNode);
  }

  get inputNode() {
    return this._inputNode;
  }

  private canvas!: HTMLCanvasElement;

  static styles = css`
    canvas {
      width: 100% !important;
      height: 100% !important;
      position: absolute;
      inset: 0;
      image-rendering: pixelated;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
  }

  private init() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x100c14);

    const backdrop = new THREE.Mesh(
      new THREE.IcosahedronGeometry(10, 5),
      new THREE.RawShaderMaterial({
        uniforms: {
          resolution: {value: new THREE.Vector2(1, 1)},
          rand: {value: 0},
        },
        vertexShader: backdropVS,
        fragmentShader: backdropFS,
        glslVersion: THREE.GLSL3,
      }),
    );
    backdrop.material.side = THREE.BackSide;
    scene.add(backdrop);
    this.backdrop = backdrop;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.set(2, -2, 5);
    this.camera = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio / 1);

    const geometry = new THREE.IcosahedronGeometry(1, 10);

    new EXRLoader().load('piz_compressed.exr', (texture: THREE.Texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const exrCubeRenderTarget = pmremGenerator.fromEquirectangular(texture);
      sphereMaterial.envMap = exrCubeRenderTarget.texture;
      sphere.visible = true;
    });

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    const sphereMaterial = new THREE.MeshStandardMaterial({
      color: 0x000010,
      metalness: 0.5,
      roughness: 0.1,
      emissive: 0x000010,
      emissiveIntensity: 1.5,
    });

    sphereMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.time = {value: 0};
      shader.uniforms.inputData = {value: new THREE.Vector4()};
      shader.uniforms.outputData = {value: new THREE.Vector4()};

      sphereMaterial.userData.shader = shader;

      shader.vertexShader = sphereVS;
    };

    const sphere = new THREE.Mesh(geometry, sphereMaterial);
    scene.add(sphere);
    sphere.visible = false;

    this.sphere = sphere;

    // Initialize 3 concentric expanding rings for the SPEAKING state
    const ringCount = 3;
    for (let i = 0; i < ringCount; i++) {
      const ringGeo = new THREE.TorusGeometry(1.0, 0.012, 4, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00d2ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      scene.add(ring);
      this.rings.push(ring);
      this.ringMaterials.push(ringMat);
    }

    const renderPass = new RenderPass(scene, camera);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      5,
      0.5,
      0,
    );

    const fxaaPass = new ShaderPass(FXAAShader);

    const composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    // composer.addPass(fxaaPass);
    composer.addPass(bloomPass);

    this.composer = composer;

    function onWindowResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      const dPR = renderer.getPixelRatio();
      const w = window.innerWidth;
      const h = window.innerHeight;
      backdrop.material.uniforms.resolution.value.set(w * dPR, h * dPR);
      renderer.setSize(w, h);
      composer.setSize(w, h);
      fxaaPass.material.uniforms['resolution'].value.set(
        1 / (w * dPR),
        1 / (h * dPR),
      );
    }

    window.addEventListener('resize', onWindowResize);
    onWindowResize();

    this.animation();
  }

  private animation() {
    requestAnimationFrame(() => this.animation());

    if (this.inputAnalyser) this.inputAnalyser.update();
    if (this.outputAnalyser) this.outputAnalyser.update();

    const t = performance.now();
    const dt = (t - this.prevTime) / (1000 / 60);
    this.prevTime = t;
    const backdropMaterial = this.backdrop.material as THREE.RawShaderMaterial;
    const sphereMaterial = this.sphere.material as THREE.MeshStandardMaterial;

    backdropMaterial.uniforms.rand.value = Math.random() * 10000;

    if (sphereMaterial && sphereMaterial.userData.shader) {
      // 1. Gather analyser input data or use state defaults
      let inputVal0 = (this.inputAnalyser && this.inputAnalyser.data) ? this.inputAnalyser.data[0] : 0;
      let inputVal1 = (this.inputAnalyser && this.inputAnalyser.data) ? this.inputAnalyser.data[1] : 0;
      let inputVal2 = (this.inputAnalyser && this.inputAnalyser.data) ? this.inputAnalyser.data[2] : 0;

      let outputVal0 = (this.outputAnalyser && this.outputAnalyser.data) ? this.outputAnalyser.data[0] : 0;
      let outputVal1 = (this.outputAnalyser && this.outputAnalyser.data) ? this.outputAnalyser.data[1] : 0;
      let outputVal2 = (this.outputAnalyser && this.outputAnalyser.data) ? this.outputAnalyser.data[2] : 0;

      // 2. Map aegisState to dynamic default visual pulses
      let targetColor = 0x000010;
      let targetEmissive = 0x000010;
      let targetEmissiveIntensity = 1.5;
      let scaleOffset = 0;
      let speedMultiplier = 1.0;

      if (this.aegisState === 'STANDBY') {
        targetColor = 0x00030f;
        targetEmissive = 0x00122e; // cool deep space blue
        targetEmissiveIntensity = 0.8 + Math.sin(t * 0.002) * 0.2;
        scaleOffset = Math.sin(t * 0.001) * 0.02;
        speedMultiplier = 0.6;
        
        // Steady background activity
        inputVal0 = Math.max(inputVal0, 10 + Math.sin(t * 0.003) * 5);
      } else if (this.aegisState === 'LISTENING') {
        // "pulsing blue" state
        targetColor = 0x051330; // dark sapphire blue
        targetEmissive = 0x2563eb; // vibrant royal/sky blue
        // Deep breathing pulse animation
        const pulseCycle = Math.sin(t * 0.009) * 0.5 + 0.5; // 0 to 1
        targetEmissiveIntensity = 2.2 + pulseCycle * 1.8 + (inputVal1 / 255) * 1.5;
        scaleOffset = pulseCycle * 0.08 + (inputVal1 / 255) * 0.12;
        speedMultiplier = 1.2;

        // Visual feedback for microphone capture
        inputVal0 = Math.max(inputVal0, 90 + Math.sin(t * 0.05) * 50);
        inputVal1 = Math.max(inputVal1, 70 + Math.cos(t * 0.03) * 40);
        inputVal2 = Math.max(inputVal2, 110 + Math.sin(t * 0.07) * 60);
      } else if (this.aegisState === 'THINKING') {
        // "shimmering gold" state
        targetColor = 0x221200; // bronze background
        targetEmissive = 0xd97706; // shimmering golden amber
        // High frequency shimmer/sparkle jitter
        const shimmerFreq = Math.sin(t * 0.11) * 0.4 + Math.cos(t * 0.18) * 0.3;
        targetEmissiveIntensity = 3.6 + shimmerFreq * 1.6;
        scaleOffset = Math.sin(t * 0.035) * 0.02 + shimmerFreq * 0.025; // jitter vibration
        speedMultiplier = 2.9;

        // Shift waves rapidly
        inputVal0 = Math.max(inputVal0, 50 + Math.sin(t * 0.1) * 30);
        inputVal1 = Math.max(inputVal1, 60 + Math.cos(t * 0.14) * 35);
        inputVal2 = Math.max(inputVal2, 70 + Math.sin(t * 0.12) * 40);
        outputVal0 = Math.max(outputVal0, 50 + Math.sin(t * 0.1) * 30);
      } else if (this.aegisState === 'SPEAKING') {
        // "expanding rings" state
        targetColor = 0x000c24; // deep midnight blue
        targetEmissive = 0x00d2ff; // vibrant electric neon blue
        targetEmissiveIntensity = 2.6 + Math.sin(t * 0.008) * 0.6 + (outputVal1 / 255) * 1.8;
        scaleOffset = Math.sin(t * 0.008) * 0.07 + (outputVal1 / 255) * 0.16;
        speedMultiplier = 1.0;

        // Strong output animations
        outputVal0 = Math.max(outputVal0, 130 + Math.sin(t * 0.04) * 70);
        outputVal1 = Math.max(outputVal1, 90 + Math.cos(t * 0.02) * 50);
        outputVal2 = Math.max(outputVal2, 150 + Math.sin(t * 0.06) * 60);
      }

      // Smooth color and intensity interpolation
      sphereMaterial.color.lerp(new THREE.Color(targetColor), dt * 0.08);
      sphereMaterial.emissive.lerp(new THREE.Color(targetEmissive), dt * 0.08);
      sphereMaterial.emissiveIntensity = THREE.MathUtils.lerp(
        sphereMaterial.emissiveIntensity,
        targetEmissiveIntensity,
        dt * 0.08
      );

      // Deform and scale sphere
      const audioScale = (0.25 * outputVal1) / 255 + (0.15 * inputVal1) / 255;
      const baseScale = 1.0 + scaleOffset + audioScale;
      this.sphere.scale.setScalar(baseScale);

      // Sphere rotation vectors
      const f = 0.001 * speedMultiplier;
      this.rotation.x += (dt * f * 0.5 * outputVal1) / 255 + (dt * f * 0.05);
      this.rotation.z += (dt * f * 0.5 * inputVal1) / 255 + (dt * f * 0.05);
      this.rotation.y += (dt * f * 0.25 * inputVal2) / 255;
      this.rotation.y += (dt * f * 0.25 * outputVal2) / 255 + (dt * f * 0.1);

      const euler = new THREE.Euler(
        this.rotation.x,
        this.rotation.y,
        this.rotation.z,
      );
      const quaternion = new THREE.Quaternion().setFromEuler(euler);
      const vector = new THREE.Vector3(0, 0, 5);
      vector.applyQuaternion(quaternion);
      this.camera.position.copy(vector);
      this.camera.lookAt(this.sphere.position);

      sphereMaterial.userData.shader.uniforms.time.value +=
        dt * 0.05 * speedMultiplier + (dt * 0.1 * outputVal0) / 255;
      sphereMaterial.userData.shader.uniforms.inputData.value.set(
        (1 * inputVal0) / 255,
        (0.1 * inputVal1) / 255,
        (10 * inputVal2) / 255,
        0,
      );
      sphereMaterial.userData.shader.uniforms.outputData.value.set(
        (2 * outputVal0) / 255,
        (0.1 * outputVal1) / 255,
        (10 * outputVal2) / 255,
        0,
      );

      // --- ANIMATE THE 3D EXPANDING RINGS ---
      const targetSpeakingTrans = (this.aegisState === 'SPEAKING') ? 1.0 : 0.0;
      this.speakingTransition = THREE.MathUtils.lerp(this.speakingTransition, targetSpeakingTrans, dt * 0.08);

      const ringCount = this.rings.length;
      for (let i = 0; i < ringCount; i++) {
        const ring = this.rings[i];
        const ringMat = this.ringMaterials[i];

        if (ring && ringMat) {
          // Calculate expanding shockwave progress (0.0 to 1.0)
          // Boost speed slightly using the live voice amplitude for organic feel
          const voiceAmp = outputVal1 / 255;
          const progress = (t * 0.0007 * (1.0 + voiceAmp * 1.5) + i / ringCount) % 1.0;

          // Align the flat ring perfectly with the camera plane
          ring.quaternion.copy(this.camera.quaternion);

          // Position rings around the sphere
          ring.position.copy(this.sphere.position);

          // Rings start at the sphere edge and expand outwards
          const ringScale = 1.0 + progress * 2.8;
          ring.scale.setScalar(ringScale);

          // Fade in near the orb, fade out as they expand into deep space
          let opacity = 0;
          if (progress < 0.2) {
            opacity = progress / 0.2;
          } else {
            opacity = 1.0 - (progress - 0.2) / 0.8;
          }

          // Apply gorgeous electric blue neon glow styling
          ringMat.color.setHex(0x00d2ff);
          ringMat.opacity = opacity * this.speakingTransition * 0.85;
          ringMat.visible = ringMat.opacity > 0.01;
        }
      }
    }

    this.composer.render();
  }

  protected firstUpdated() {
    this.canvas = this.shadowRoot!.querySelector('canvas') as HTMLCanvasElement;
    this.init();
  }

  protected render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-live-audio-visuals-3d': GdmLiveAudioVisuals3D;
  }
}
