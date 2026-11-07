/* Kit3 — drawn 3D for a storyshot scene: solids shaded by which way they face, with ink edges found
   in a normal/depth pass, so a shape reads as a textbook figure rather than as a render.

   Why not just light it. A lit render says "photograph"; a diagram has to say "drawing". Three things
   do that, and none of them is a light:
     1. Flat tone by FACING. Each face gets one of three tones picked from its own normal — no falloff,
        no specular, no shadows. Curved things step smoothly between tones so they never staircase.
     2. INK EDGES drawn after the fact. The scene is rendered a second time into a buffer that holds
        the view normal, a line tone and the depth; a full-screen pass then marks a pixel as a line
        where the normal turns a corner or the depth jumps. That gives silhouettes AND creases, which
        is what a draughtsman draws and what a light never produces.
     3. A LONG LENS. Perspective at fov 18 is nearly axonometric: parallel edges stay parallel, so the
        figure reads as a diagram instead of as a photograph of an object.
   The approach is the standard non-photorealistic one and is the same idea Atlas of Physics uses
   (MIT, nathanliow/atlas-of-physics); this is storyshot's own implementation of it.

   It draws only when asked. Everything on screen is a function of the timeline's time, so a scene
   calls eng.render() from its GSAP onUpdate and never from a frame loop — frames are rendered by
   seeking, and a clock of its own would make every render different.

   The UMD build of three.js carries no addons (no EffectComposer, no ShaderPass), so the two passes
   and the composite here are written against plain render targets.

   Scenes use it like this:

     const eng = Kit3.engine(canvas, { bg: '#0f1218', ink: '#0a0c10' });
     const flask = eng.part(eng.scene, { explode: [0, 220, 0] });
     eng.solid(flask, new THREE.CylinderGeometry(1, 1, 2, 48), { ramp: Kit3.RAMP.glass, tone: 'hi' });
     eng.look({ target: [0, 0.6, 0], az: -0.7, el: 0.42, dist: 26 });
     ...
     tl.fromTo(p, { t: 0 }, { t: S.duration, duration: S.duration, ease: 'none',
       onUpdate() { eng.explode(k(p.t)); eng.render(); } }, 0);
*/
window.Kit3 = (function () {
  /* How dark a line is, the way a draughtsman grades them: a part that is only context gets a faint
     edge, the one thing being talked about gets the full one. Stored per solid, read by the edge pass. */
  const TONE = { ghost: 0.15, faint: 0.3, lo: 0.5, mid: 0.7, hi: 0.85, lit: 1.0 };

  /* A ramp is [top, lightSide, darkSide] — the three tones a solid can show. A film gives its own,
     in its own palette; these are the neutrals every film can fall back on. */
  const RAMP = {
    paper: ['#ffffff', '#f2f1ec', '#d8d6cf'],
    panel: ['#2b313d', '#222834', '#171b23'],
    glass: ['#39414f', '#2a313d', '#1d222c'],
    dead: ['#3a3f4a', '#2f343e', '#262a33'],
  };

  const hex = (c) => new THREE.Color(c);

  /* ---- the beauty pass: three tones chosen by which way the face points ------------------------ */
  // The side tone comes from the horizontal part of the world normal, so turning the camera does not
  // repaint the object: a figure that re-shades while the camera moves reads as lit, not as drawn.
  // The instancing guard is what lets one call draw a flask's worth of cells: three.js defines
  // USE_INSTANCING for an InstancedMesh, and the normal has to be turned by the instance too.
  const SHADE_VERT = `
    varying vec3 vN;
    void main() {
      vec3 n = normal;
      #ifdef USE_INSTANCING
        n = mat3(instanceMatrix) * n;
      #endif
      vN = normalize(mat3(modelMatrix) * n);
      #include <begin_vertex>
      #include <project_vertex>
    }`;
  const SHADE_FRAG = `
    uniform vec3 uTop, uLight, uDark;
    uniform float uOpacity, uLit;
    varying vec3 vN;
    void main() {
      vec3 n = normalize(vN);
      // sides: blend the two side tones by how much the face turns towards the light direction.
      // Continuous, so a cylinder steps through the tones instead of banding into facets.
      float side = clamp(dot(normalize(vec3(-0.55, 0.0, 0.83)), normalize(vec3(n.x, 0.0, n.z) + 1e-5)) * 0.5 + 0.5, 0.0, 1.0);
      vec3 c = mix(uDark, uLight, side);
      c = mix(c, uTop, smoothstep(0.55, 0.95, n.y));            // tops catch the page's light
      c = mix(c, uDark * 0.94, smoothstep(-0.45, -0.95, n.y));  // undersides sit down
      c = mix(c, uTop, uLit * 0.4);                             // the one thing being named lifts
      gl_FragColor = vec4(c, uOpacity);
    }`;

  /* ---- the line pass: view normal (xy), line tone, depth ---------------------------------------- */
  // Only xy of the view normal is kept: z is recoverable and the blue channel is worth more as the
  // per-solid line tone, which is what lets one part be drawn heavier than the rest.
  const NORM_VERT = `
    varying vec3 vVN; varying float vDepth;
    void main() {
      vec3 n = normal;
      #ifdef USE_INSTANCING
        n = mat3(instanceMatrix) * n;
      #endif
      vVN = normalize(normalMatrix * n);
      #include <begin_vertex>
      #include <project_vertex>
      vDepth = -mvPosition.z;
    }`;
  const NORM_FRAG = `
    uniform float uTone, uFar;
    varying vec3 vVN; varying float vDepth;
    void main() {
      vec3 n = normalize(vVN);
      gl_FragColor = vec4(n.xy * 0.5 + 0.5, uTone, clamp(vDepth / uFar, 0.0, 1.0));
    }`;

  /* ---- the composite: find the edges, ink them over the colour --------------------------------- */
  const EDGE_FRAG = `
    uniform sampler2D uColor, uNormal;
    uniform vec2 uTexel;
    uniform vec3 uInk;
    uniform float uNormalCut, uDepthCut, uWeight;
    varying vec2 vUv;

    vec4 nd(vec2 uv) { return texture2D(uNormal, uv); }

    void main() {
      vec4 c = texture2D(uColor, vUv);
      vec4 m = nd(vUv);
      // four neighbours is enough for a 1 px line and keeps the pass cheap at 1920x1080
      vec4 l = nd(vUv - vec2(uTexel.x, 0.0)), r = nd(vUv + vec2(uTexel.x, 0.0));
      vec4 d = nd(vUv - vec2(0.0, uTexel.y)), u = nd(vUv + vec2(0.0, uTexel.y));

      // a crease: the normal turns a corner
      float dn = max(max(length(l.xy - m.xy), length(r.xy - m.xy)),
                     max(length(d.xy - m.xy), length(u.xy - m.xy)));
      // a silhouette: the depth jumps. Scaled by distance so a far edge is not thicker than a near one.
      float dd = max(max(abs(l.a - m.a), abs(r.a - m.a)), max(abs(d.a - m.a), abs(u.a - m.a)));
      dd = dd / max(m.a, 0.02);

      float edge = max(smoothstep(uNormalCut, uNormalCut * 2.4, dn),
                       smoothstep(uDepthCut, uDepthCut * 2.6, dd));
      // the heaviest tone around the pixel wins, so a lit part keeps its full line against a faint one
      float tone = max(max(l.b, r.b), max(max(d.b, u.b), m.b));
      gl_FragColor = vec4(mix(c.rgb, uInk, clamp(edge * tone * uWeight, 0.0, 1.0)), 1.0);
    }`;

  function engine(canvas, opts = {}) {
    const W = canvas.width, H = canvas.height;
    const bg = opts.bg ?? '#ffffff', ink = opts.ink ?? '#18181a', FAR = opts.far ?? 200;

    // A diagram's colours are chosen, not photographed: with colour management off and the output
    // left linear, a hex in the palette lands in the frame as exactly that hex, and two renders of
    // the same second are the same pixels.
    THREE.ColorManagement.enabled = false;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.setClearColor(hex(bg), 1);
    renderer.autoClear = true;

    const scene = new THREE.Scene();
    // fov 18: a long lens. Parallel edges stay nearly parallel, which is what makes it read as a figure.
    const camera = new THREE.PerspectiveCamera(opts.fov ?? 18, W / H, 0.1, FAR);

    // Two buffers at the frame's own size: colour, and (normal.xy, tone, depth).
    const rtOpts = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false };
    const rtColor = new THREE.WebGLRenderTarget(W, H, rtOpts);
    const rtNorm = new THREE.WebGLRenderTarget(W, H, { ...rtOpts, type: THREE.HalfFloatType });

    const quadScene = new THREE.Scene();
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const edgeMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: rtColor.texture }, uNormal: { value: rtNorm.texture },
        uTexel: { value: new THREE.Vector2(1 / W, 1 / H) }, uInk: { value: hex(ink) },
        uNormalCut: { value: opts.creaseCut ?? 0.18 }, uDepthCut: { value: opts.silhouetteCut ?? 0.012 },
        uWeight: { value: opts.inkWeight ?? 1 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: EDGE_FRAG, depthTest: false, depthWrite: false,
    });
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), edgeMat));

    const parts = [];                 // everything that can be pulled apart
    const normMats = new Map();       // one line-pass material per tone value

    const normalFor = (tone) => {
      if (!normMats.has(tone)) normMats.set(tone, new THREE.ShaderMaterial({
        uniforms: { uTone: { value: tone }, uFar: { value: FAR } },
        vertexShader: NORM_VERT, fragmentShader: NORM_FRAG,
      }));
      return normMats.get(tone);
    };

    const api = {
      THREE, scene, camera, renderer, parts,

      /* A group that can be pulled out of the assembly. `at` is where it sits assembled and `explode`
         where it goes when pulled apart; explode(k) then moves every part along its own vector.
         Pass `at` rather than setting .position afterwards: the part remembers where home is, and
         the next explode(k) would otherwise put it back at the origin instead. */
      part(parent, { at = [0, 0, 0], explode = [0, 0, 0], name = '' } = {}) {
        const g = new THREE.Group();
        g.position.set(...at);
        g.userData.home = g.position.clone();
        g.userData.out = new THREE.Vector3(...explode);
        g.userData.name = name;
        parent.add(g);
        parts.push(g);
        return g;
      },

      /* One drawn solid. `ramp` is its three tones, `tone` how heavy its ink line is. */
      solid(parent, geometry, { ramp = RAMP.paper, tone = 'mid', opacity = 1, lit = 0 } = {}) {
        const [top, light, dark] = ramp;
        const mat = new THREE.ShaderMaterial({
          uniforms: {
            uTop: { value: hex(top) }, uLight: { value: hex(light) }, uDark: { value: hex(dark) },
            uOpacity: { value: opacity }, uLit: { value: lit },
          },
          vertexShader: SHADE_VERT, fragmentShader: SHADE_FRAG,
          transparent: opacity < 1, depthWrite: opacity >= 1,
        });
        const m = new THREE.Mesh(geometry, mat);
        m.userData.tone = typeof tone === 'number' ? tone : (TONE[tone] ?? TONE.mid);
        m.userData.shade = mat;
        parent.add(m);
        return m;
      },

      /* Many copies of one shape in one draw call — a flask's worth of cells, a rack of guides.
         Place them with setMatrixAt + instanceMatrix.needsUpdate, and set .count to how many are
         on screen this frame; the ones past the count are simply not drawn. */
      instances(parent, geometry, count, { ramp = RAMP.paper, tone = 'mid', opacity = 1, lit = 0 } = {}) {
        const probe = api.solid(parent, geometry, { ramp, tone, opacity, lit });
        parent.remove(probe);
        const inst = new THREE.InstancedMesh(geometry, probe.material, count);
        inst.userData = probe.userData;
        inst.count = 0;
        // An InstancedMesh is culled against ONE bounding sphere: the geometry's, around the mesh's
        // own origin. Instances placed anywhere else — a field of particles crossing the frame, cells
        // laid out across a flask — put nothing in that sphere, so the whole batch is culled and
        // simply never appears. A diagram holds a handful of batches, so stop culling them.
        inst.frustumCulled = false;
        parent.add(inst);
        return inst;
      },

      /* Light one solid up without changing its colour: the tone lifts and its line goes to full. */
      lift(mesh, k) {
        mesh.userData.shade.uniforms.uLit.value = k;
        mesh.userData.tone = TONE.faint + (TONE.lit - TONE.faint) * k;
      },

      /* Fading a solid has to take its LINE with it. The line pass draws every mesh with an opaque
         material of its own, so a solid at opacity 0 keeps a full-strength ink edge and goes on
         hanging in the frame as a wireframe ghost. Below a hair's width of opacity the mesh leaves
         both passes. */
      fade(mesh, o) {
        mesh.userData.shade.uniforms.uOpacity.value = o;
        mesh.userData.shade.transparent = o < 1;
        mesh.userData.shade.depthWrite = o >= 1;
        mesh.visible = o > 0.004;
      },

      /* Place the camera the way a figure is staged: look at a point from an angle and a distance.
         `shift` slides the whole camera sideways afterwards, in world units along the camera's OWN
         right axis, which is how you leave the left third of the frame for the words. Offsetting the
         target instead looks right until the azimuth changes: world x is not screen right, so the
         subject swings and comes towards the lens as the camera turns. Negative shift = subject right. */
      look({ target = [0, 0, 0], az = -0.7, el = 0.42, dist = 30, shift = 0, rise = 0 } = {}) {
        const [tx, ty, tz] = target;
        camera.position.set(tx + Math.sin(az) * Math.cos(el) * dist, ty + Math.sin(el) * dist, tz + Math.cos(az) * Math.cos(el) * dist);
        camera.lookAt(tx, ty, tz);
        if (shift || rise) {
          camera.updateMatrixWorld(true);
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
          const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
          camera.position.addScaledVector(right, shift).addScaledVector(up, rise);
          camera.updateMatrixWorld(true);
        }
      },

      /* 0 = assembled, 1 = fully apart. One number drives the whole exploded view. */
      explode(k) {
        for (const g of parts) g.position.copy(g.userData.home).addScaledVector(g.userData.out, k);
      },

      /* Two passes and the composite. Called from the timeline, never from a loop. */
      render() {
        renderer.setRenderTarget(rtColor);
        renderer.setClearColor(hex(bg), 1);
        renderer.clear();
        renderer.render(scene, camera);

        // the line pass: swap every mesh to its tone's normal material, then swap back
        const saved = [];
        scene.traverse((o) => {
          if (o.isMesh) { saved.push([o, o.material]); o.material = normalFor(o.userData.tone ?? TONE.mid); }
        });
        renderer.setRenderTarget(rtNorm);
        // far depth and a normal that matches nothing, so the background never grows an edge of its own
        renderer.setClearColor(0x000000, 1);
        renderer.clear();
        renderer.render(scene, camera);
        for (const [o, m] of saved) o.material = m;

        renderer.setRenderTarget(null);
        renderer.render(quadScene, quadCam);
      },
    };
    return api;
  }

  /* A box with soft corners and a bevelled edge, standing on y = 0. A sharp box drawn with ink edges
     reads as a crate; most lab plastic is rounded, and the bevel is what gives the silhouette the
     double line that says "moulded object" rather than "cube". */
  function slab(w, h, d, r = 0.6, bevel = 0.14) {
    const x = w / 2, z = d / 2, rr = Math.max(0.01, Math.min(r, x - 0.01, z - 0.01));
    const s = new THREE.Shape();
    s.moveTo(-x + rr, -z);
    s.lineTo(x - rr, -z); s.quadraticCurveTo(x, -z, x, -z + rr);
    s.lineTo(x, z - rr); s.quadraticCurveTo(x, z, x - rr, z);
    s.lineTo(-x + rr, z); s.quadraticCurveTo(-x, z, -x, z - rr);
    s.lineTo(-x, -z + rr); s.quadraticCurveTo(-x, -z, -x + rr, -z);
    const g = new THREE.ExtrudeGeometry(s, {
      depth: Math.max(0.01, h - bevel * 2), bevelEnabled: bevel > 0,
      bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 8,
    });
    g.rotateX(-Math.PI / 2);   // ExtrudeGeometry grows along +Z; stand it up on +Y
    g.translate(0, bevel, 0);  // and sit it on the ground rather than straddling it
    return g;
  }

  /* A seeded random number generator (mulberry32). A scene is rendered by seeking, and the same
     second has to come back the same pixels every time, so `Math.random()` is banned outright —
     scattering cells in a flask or jittering a crowd needs a generator that starts from a number.
     Give each scattered thing its own seed so adding one does not reshuffle the rest. */
  function rng(seed = 1) {
    let a = (seed >>> 0) + 0x6d2b79f5;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return { engine, slab, rng, TONE, RAMP };
})();
