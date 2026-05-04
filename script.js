import * as THREE from 'three';
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── DOM refs ──
const canvas      = document.getElementById('three-canvas');
const viewerWrap  = document.getElementById('viewer-wrap');
const loadingEl   = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const infoPanel   = document.getElementById('info-panel');
const clickHint   = document.getElementById('click-hint');

// ── Renderer ──
const W = 569, H = 520;
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0); // transparent bg

// ── Camera ── isometric-style perspective
const camera = new THREE.PerspectiveCamera(40, W / H, 0.001, 2000);
camera.position.set(6, 5, 6);

// ── Scene ──
const scene = new THREE.Scene();

// ── Lights ──
const ambient = new THREE.AmbientLight(0xffffff, 1.8);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(8, 12, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.1;
sun.shadow.camera.far = 200;
scene.add(sun);

const fill = new THREE.DirectionalLight(0xffd4a0, 0.7);
fill.position.set(-6, 4, -8);
scene.add(fill);

// ── OrbitControls ──
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.screenSpacePanning = true;
controls.minDistance = 0.05;
controls.maxDistance = 500;
controls.zoomSpeed = 1.2;

// ── State ──
let modelRoot = null;
const origMaterials = new Map(); // uuid → original material
let selectedMesh   = null;
let furnitureOn    = true;
let lightMode      = 0;
const LIGHT_MODES  = ['Natural', 'Warm', 'Cool', 'Dramatic'];

// highlight material
const highlightMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: new THREE.Color(0xed7119),
  emissiveIntensity: 0.55,
  roughness: 0.4,
  metalness: 0.1,
});

// ── Load GLB ──
const loader = new GLTFLoader();

loader.load(
  'assets/model.glb',
  (gltf) => {
    modelRoot = gltf.scene;
    scene.add(modelRoot);

    // Center & auto-scale
    const box    = new THREE.Box3().setFromObject(modelRoot);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale  = 5 / maxDim;

    modelRoot.scale.setScalar(scale);
    modelRoot.position.copy(center.multiplyScalar(-scale));

    // Shadow + material cache
    modelRoot.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow    = true;
      child.receiveShadow = true;

      // Handle array materials
      if (Array.isArray(child.material)) {
        child.material = child.material.map(m => m.clone());
        origMaterials.set(child.uuid, child.material.map(m => m.clone()));
      } else {
        child.material = child.material.clone();
        origMaterials.set(child.uuid, child.material.clone());
      }
    });

    // Fit camera to model
    const scaled = new THREE.Box3().setFromObject(modelRoot);
    const sc     = scaled.getCenter(new THREE.Vector3());
    const ss     = scaled.getSize(new THREE.Vector3());
    const maxS   = Math.max(ss.x, ss.y, ss.z);

    camera.position.set(
      sc.x + maxS * 1.1,
      sc.y + maxS * 0.9,
      sc.z + maxS * 1.1
    );
    controls.target.copy(sc);
    controls.update();

    // Add subtle ground grid
    const grid = new THREE.GridHelper(maxS * 3, 20, 0xc8b8a4, 0xddd0c0);
    grid.position.copy(sc);
    grid.position.y = scaled.min.y - 0.01;
    scene.add(grid);

    loadingEl.style.display = 'none';
    clickHint.style.opacity = '1';
  },
  (xhr) => {
    if (xhr.total) {
      loadingText.textContent = `Loading… ${Math.round(xhr.loaded / xhr.total * 100)}%`;
    }
  },
  (err) => {
    loadingText.textContent = '⚠ Failed to load model';
    console.error('GLTFLoader error:', err);
  }
);

// ── Raycasting ──
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

canvas.addEventListener('click', (e) => {
  if (!modelRoot) return;

  const rect = canvas.getBoundingClientRect();
  mouse.x =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
  mouse.y = -((e.clientY - rect.top)   / rect.height)  * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  const meshes = [];
  modelRoot.traverse(c => { if (c.isMesh && c.visible) meshes.push(c); });

  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length > 0) {
    selectMesh(hits[0].object);
  } else {
    deselectMesh();
  }
});

// ── Select / Deselect ──
function selectMesh(mesh) {
  if (selectedMesh && selectedMesh !== mesh) restoreMesh(selectedMesh);

  selectedMesh = mesh;

  // Apply highlight (preserve original, apply orange emissive)
  const orig = origMaterials.get(mesh.uuid);
  if (Array.isArray(orig)) {
    mesh.material = orig.map(m => {
      const h = m.clone();
      h.emissive = new THREE.Color(0xed7119);
      h.emissiveIntensity = 0.45;
      return h;
    });
  } else {
    const h = orig.clone();
    h.emissive = new THREE.Color(0xed7119);
    h.emissiveIntensity = 0.45;
    mesh.material = h;
  }

  showInfo(mesh);
  clickHint.style.opacity = '0';
}

function deselectMesh() {
  if (selectedMesh) {
    restoreMesh(selectedMesh);
    selectedMesh = null;
  }
  infoPanel.classList.add('hidden');
  clickHint.style.opacity = '1';
}

function restoreMesh(mesh) {
  const orig = origMaterials.get(mesh.uuid);
  if (orig) mesh.material = Array.isArray(orig) ? orig.map(m => m.clone()) : orig.clone();
}

// ── Info Panel ──
function showInfo(mesh) {
  const box  = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());

  const matArr = Array.isArray(origMaterials.get(mesh.uuid))
    ? origMaterials.get(mesh.uuid)
    : [origMaterials.get(mesh.uuid)];
  const matName = matArr.map(m => m?.name || m?.type || '—').join(', ');

  const geo   = mesh.geometry;
  const verts = geo.attributes.position?.count ?? '—';
  const faces = geo.index ? Math.round(geo.index.count / 3) : Math.round(verts / 3);

  document.getElementById('i-name').textContent  = mesh.name || '(unnamed)';
  document.getElementById('i-mat').textContent   = matName;
  document.getElementById('i-w').textContent     = size.x.toFixed(4) + ' u';
  document.getElementById('i-h').textContent     = size.y.toFixed(4) + ' u';
  document.getElementById('i-d').textContent     = size.z.toFixed(4) + ' u';
  document.getElementById('i-verts').textContent = typeof verts === 'number' ? verts.toLocaleString() : verts;
  document.getElementById('i-faces').textContent = typeof faces === 'number' ? faces.toLocaleString() : faces;

  infoPanel.classList.remove('hidden');
}

document.getElementById('info-close').addEventListener('click', deselectMesh);
document.getElementById('info-deselect').addEventListener('click', deselectMesh);

// ── Lighting Modes ──
document.getElementById('btn-lighting').addEventListener('click', () => {
  lightMode = (lightMode + 1) % LIGHT_MODES.length;
  const mode = LIGHT_MODES[lightMode];
  document.getElementById('lbl-lighting').textContent = `Lighting: ${mode}`;
  document.getElementById('btn-lighting').classList.toggle('active-btn', lightMode !== 0);

  switch (mode) {
    case 'Warm':
      ambient.color.set(0xffe4b0); ambient.intensity = 2.0;
      sun.color.set(0xffa055);     sun.intensity = 2.0;
      fill.color.set(0xffcc88);
      break;
    case 'Cool':
      ambient.color.set(0xc0d4f0); ambient.intensity = 2.2;
      sun.color.set(0x99bbff);     sun.intensity = 1.8;
      fill.color.set(0x88aadd);
      break;
    case 'Dramatic':
      ambient.color.set(0x111111); ambient.intensity = 0.4;
      sun.color.set(0xffffff);     sun.intensity = 5.0;
      fill.color.set(0x220000);
      break;
    default: // Natural
      ambient.color.set(0xffffff); ambient.intensity = 1.8;
      sun.color.set(0xffffff);     sun.intensity = 2.5;
      fill.color.set(0xffd4a0);
  }
});

// ── Hide / Show Furniture ──
document.getElementById('btn-furniture').addEventListener('click', () => {
  if (!modelRoot) return;
  furnitureOn = !furnitureOn;
  modelRoot.traverse(c => {
    if (c.isMesh) c.visible = furnitureOn;
  });
  document.getElementById('lbl-furniture').textContent =
    furnitureOn ? 'Hide Furniture' : 'Show Furniture';
  document.getElementById('btn-furniture').classList.toggle('active-btn', !furnitureOn);
});

// ── Show Info (toggle panel for already-selected mesh) ──
document.getElementById('btn-showinfo').addEventListener('click', () => {
  if (selectedMesh) {
    infoPanel.classList.toggle('hidden');
    document.getElementById('btn-showinfo').classList.toggle(
      'active-btn', !infoPanel.classList.contains('hidden')
    );
  } else {
    clickHint.textContent = 'Click a component first';
    setTimeout(() => { clickHint.textContent = 'Click a component to inspect'; }, 2000);
  }
});

// ── Change Time (sun angle) ──
const TIME_ANGLES = [
  { name: 'Dawn',   az: 0.3,  el: 0.2 },
  { name: 'Morning',az: 1.0,  el: 0.6 },
  { name: 'Noon',   az: 1.57, el: 1.4 },
  { name: 'Evening',az: 2.5,  el: 0.5 },
  { name: 'Dusk',   az: 3.0,  el: 0.15 },
];
let timeIdx = 2; // start at noon

document.getElementById('btn-time').addEventListener('click', () => {
  timeIdx = (timeIdx + 1) % TIME_ANGLES.length;
  const t = TIME_ANGLES[timeIdx];
  const d = 12;
  sun.position.set(
    d * Math.cos(t.el) * Math.sin(t.az),
    d * Math.sin(t.el),
    d * Math.cos(t.el) * Math.cos(t.az)
  );
  document.getElementById('btn-time').querySelector('.ctrl-label').textContent =
    `Time: ${t.name}`;
  document.getElementById('btn-time').classList.add('active-btn');
});

// ── Change Material (surface tint) ──
const MATERIAL_MODES = [
  { name: 'Default',  color: null },
  { name: 'Concrete', color: 0xb0a898 },
  { name: 'Wood',     color: 0x8b6343 },
  { name: 'White',    color: 0xf5f5f2 },
];
let matModeIdx = 0;

document.getElementById('btn-material').addEventListener('click', () => {
  if (!modelRoot) return;
  matModeIdx = (matModeIdx + 1) % MATERIAL_MODES.length;
  const mode = MATERIAL_MODES[matModeIdx];

  modelRoot.traverse(c => {
    if (!c.isMesh) return;
    const orig = origMaterials.get(c.uuid);
    if (mode.color === null) {
      // restore original
      c.material = Array.isArray(orig) ? orig.map(m => m.clone()) : orig.clone();
    } else {
      const tintColor = new THREE.Color(mode.color);
      if (Array.isArray(orig)) {
        c.material = orig.map(m => {
          const nm = m.clone();
          nm.color.lerp(tintColor, 0.6);
          return nm;
        });
      } else {
        const nm = orig.clone();
        nm.color.lerp(tintColor, 0.6);
        c.material = nm;
      }
    }
  });

  // If something is selected, keep its highlight
  if (selectedMesh) selectMesh(selectedMesh);

  document.getElementById('lbl-material').textContent = `Material: ${mode.name}`;
  document.getElementById('btn-material').classList.toggle('active-btn', matModeIdx !== 0);
});

// ── Change Layout (rotate model) ──
const LAYOUT_ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
let layoutIdx = 0;

document.getElementById('btn-layout').addEventListener('click', () => {
  if (!modelRoot) return;
  layoutIdx = (layoutIdx + 1) % LAYOUT_ANGLES.length;
  modelRoot.rotation.y = LAYOUT_ANGLES[layoutIdx];
  document.getElementById('btn-layout').classList.toggle('active-btn', layoutIdx !== 0);
});

// ── Back button ──
document.getElementById('back-btn').addEventListener('click', () => {
  if (typeof window.showPage === 'function') {
    window.showPage('view-personal-info');
  } else if (history.length > 1) {
    history.back();
  }
});

// ── Animate ──
(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();
