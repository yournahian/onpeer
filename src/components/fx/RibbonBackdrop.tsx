import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

type Theme = 'dark' | 'light'

/** The site's primary OnPeer Brandkit gradient, left to right (exact production colours). */
const PRIMARY: Record<Theme, [string, string, string]> = {
  dark: ['#c94100', '#FF5A00', '#ff8c42'],
  light: ['#b83a00', '#e04e00', '#FF5A00'],
}
/** Matches `--bg` in index.css so the canvas blends into the page. */
const PAGE_BG: Record<Theme, number> = { dark: 0x000000, light: 0xffffff }

const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
const isHelixActive = (): boolean => document.documentElement.dataset.helix !== 'off'

/**
 * Real 3D background for Swap and Bridge: a tight row of thick, rounded blocks in
 * the site's primary gradient, drifting slowly right to left. Each block turns on
 * the travel axis with a small offset from its neighbour, so the row reads as one
 * twisting helix. Follows the site theme: on the dark theme it sits on the dark page
 * background with a bloom glow, on the light theme the canvas is transparent so the
 * page's normal light background shows through.
 */
export function RibbonBackdrop() {
  const hostRef = useRef<HTMLDivElement>(null)
  const animRef = useRef({ raf: 0, simTime: 0, lastNow: 0 })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const anim = animRef.current
    if (anim.raf) {
      cancelAnimationFrame(anim.raf)
      anim.raf = 0
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(0, 0.15, 7.2)
    camera.lookAt(0, 0, 0)

    // Neutral lights so the blocks show the real primary colours, plus soft violet rims.
    const ambient = new THREE.AmbientLight(0xffffff, 0.12)
    scene.add(ambient)
    const hemi = new THREE.HemisphereLight(0xffffff, 0x0a0410, 0.4)
    scene.add(hemi)

    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(0.5, 7, 6)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -14
    key.shadow.camera.right = 14
    key.shadow.camera.top = 6
    key.shadow.camera.bottom = -6
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 30
    key.shadow.bias = -0.0006
    key.shadow.normalBias = 0.02
    scene.add(key)

    const rimL = new THREE.PointLight(0xff5a00, 45, 25, 1.7)
    rimL.position.set(-6, 3, 2)
    scene.add(rimL)
    const rimR = new THREE.PointLight(0xff5a00, 20, 25, 1.7)
    rimR.position.set(6, 2.5, 2)
    scene.add(rimR)
    const under = new THREE.PointLight(0xe04e00, 20, 18, 1.8)
    under.position.set(0, -4, 3)
    scene.add(under)

    // Thick rounded blocks, tightly packed with thin dark seams.
    const THICK = 0.24
    const SIZE = 2.0
    const SPACING = 0.3
    const COUNT = 96
    const LENGTH = COUNT * SPACING

    const geometry = new RoundedBoxGeometry(THICK, SIZE, SIZE, 4, 0.07)
    // White base: the per-block colour (primary gradient) comes from instance colours.
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.05,
      emissive: 0x1a0800,
      emissiveIntensity: 0.5,
    })
    const blocks = new THREE.InstancedMesh(geometry, material, COUNT)
    blocks.castShadow = true
    blocks.receiveShadow = true
    blocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(blocks)

    // Fine dust drifting right to left.
    const DUST = 280
    const dustPos = new Float32Array(DUST * 3)
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 22
      dustPos[i * 3 + 1] = (Math.random() - 0.5) * 9
      dustPos[i * 3 + 2] = -2 - Math.random() * 6
    }
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
    const dustMat = new THREE.PointsMaterial({
      color: 0xf0abfc,
      size: 0.03,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      sizeAttenuation: true,
    })
    scene.add(new THREE.Points(dustGeo, dustMat))

    // Keep composer output pipeline for identical ACES tone-mapping, with 0 sky bloom halo.
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0.35, 1.0)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())

    // Theme-dependent state.
    const state = {
      theme: currentTheme(),
      stops: PRIMARY[currentTheme()].map((c) => new THREE.Color(c)),
      halfView: 6, // half the visible width at z = 0, updated on resize
    }
    const applyTheme = () => {
      state.theme = currentTheme()
      state.stops = PRIMARY[state.theme].map((c) => new THREE.Color(c))
      bloom.strength = 0
      if (state.theme === 'dark') {
        // Opaque page colour so bloom works, identical to the page background.
        renderer.setClearColor(PAGE_BG.dark, 1)
        ambient.intensity = 0.12
        hemi.intensity = 0.4
        dustMat.color.set(0xffb380)
        dustMat.opacity = 0.55
      } else {
        // Transparent: the page's own light background shows through.
        renderer.setClearColor(PAGE_BG.light, 0)
        ambient.intensity = 0.35
        hemi.intensity = 0.7
        dustMat.color.set(0xff5a00)
        dustMat.opacity = 0.35
      }
    }
    applyTheme()

    const dummy = new THREE.Object3D()
    const tmp = new THREE.Color()
    const SPEED = 0.2 // world units per second, slow drift
    const TWIST = 0.26 // radians of twist per world unit: small offset between neighbours
    const SPIN = 0.3 // radians per second: every block keeps turning on the travel axis

    /** Primary gradient by screen position: purple on the left, fuchsia in the middle, pink on the right. */
    const colorAt = (x: number) => {
      const u = Math.min(1, Math.max(0, (x + state.halfView) / (2 * state.halfView)))
      if (u < 0.55) tmp.copy(state.stops[0]).lerp(state.stops[1], u / 0.55)
      else tmp.copy(state.stops[1]).lerp(state.stops[2], (u - 0.55) / 0.45)
      return tmp
    }

    const layout = (time: number) => {
      for (let i = 0; i < COUNT; i++) {
        const raw = (i * SPACING + time * SPEED) % LENGTH
        // Blocks drift right -> left.
        const x = LENGTH / 2 - raw
        // Continuous rotation with a small offset per block; adding time makes the twist
        // pattern travel right -> left too. Depends on world x, so wrapping never jumps.
        const rot = x * TWIST + time * SPIN
        dummy.position.set(x, 0, 0)
        dummy.rotation.set(rot, 0, 0)
        dummy.updateMatrix()
        blocks.setMatrixAt(i, dummy.matrix)
        blocks.setColorAt(i, colorAt(x))
      }
      blocks.instanceMatrix.needsUpdate = true
      if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true
    }

    const render = () => {
      if (state.theme === 'dark') composer.render()
      else renderer.render(scene, camera)
    }

    const resize = () => {
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      renderer.setSize(w, h, false)
      composer.setSize(w, h)
      bloom.setSize(w, h)
      camera.aspect = w / h
      camera.position.z = w / h < 1 ? 11 : 7.2
      camera.updateProjectionMatrix()
      state.halfView = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z * camera.aspect
    }
    const ro = new ResizeObserver(() => {
      resize()
      if (reducedMotion || !isHelixActive()) {
        layout(anim.simTime)
        render()
      }
    })
    ro.observe(host)
    resize()

    const stepFrame = () => {
      anim.raf = 0
      const now = performance.now()
      const dt = Math.min(0.1, (now - anim.lastNow) / 1000)
      anim.lastNow = now
      anim.simTime += dt
      layout(anim.simTime)
      const p = dustGeo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < DUST; i++) {
        let x = p.getX(i) - 0.002
        if (x < -11) x = 11
        p.setX(i, x)
      }
      p.needsUpdate = true
      render()
      if (!reducedMotion && isHelixActive()) {
        anim.raf = requestAnimationFrame(stepFrame)
      }
    }

    const syncMotion = () => {
      applyTheme()
      layout(anim.simTime)
      render()
      if (reducedMotion || !isHelixActive()) {
        if (anim.raf) {
          cancelAnimationFrame(anim.raf)
          anim.raf = 0
        }
      } else if (!anim.raf) {
        anim.lastNow = performance.now()
        anim.raf = requestAnimationFrame(stepFrame)
      }
    }

    const onThemeChange = () => {
      applyTheme()
      if (reducedMotion || !isHelixActive()) {
        layout(anim.simTime)
        render()
      }
    }
    const themeObs = new MutationObserver(onThemeChange)
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const helixObserver = new MutationObserver(syncMotion)
    helixObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-helix'] })

    syncMotion()

    return () => {
      if (anim.raf) {
        cancelAnimationFrame(anim.raf)
        anim.raf = 0
      }
      ro.disconnect()
      themeObs.disconnect()
      helixObserver.disconnect()
      geometry.dispose()
      material.dispose()
      dustGeo.dispose()
      dustMat.dispose()
      composer.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
      <div ref={hostRef} className="absolute inset-0" />
    </div>
  )
}
