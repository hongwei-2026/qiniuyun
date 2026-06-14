import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useAppStore } from '../stores/appStore'

export function Model3DView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const model3d = useAppStore((s) => s.model3d)

  useEffect(() => {
    if (!containerRef.current || !model3d.modelUrl) return
    if (!model3d.modelUrl.toLowerCase().includes('.obj')) return

    const container = containerRef.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#f0ebe3')

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000)
    camera.position.set(2, 2, 3)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.innerHTML = ''
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    scene.add(new THREE.AmbientLight(0xffffff, 0.85))
    const dir = new THREE.DirectionalLight(0xffffff, 1)
    dir.position.set(5, 8, 5)
    scene.add(dir)

    const loader = new OBJLoader()
    let frameId = 0
    let disposed = false

    loader.load(model3d.modelUrl, (obj) => {
      if (disposed) return
      const box = new THREE.Box3().setFromObject(obj)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      obj.position.sub(center)
      obj.scale.setScalar(1.8 / (Math.max(size.x, size.y, size.z) || 1))
      scene.add(obj)
    })

    const animate = () => {
      frameId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      camera.aspect = container.clientWidth / container.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(container.clientWidth, container.clientHeight)
    }
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      renderer.dispose()
      container.innerHTML = ''
    }
  }, [model3d.modelUrl])

  return (
    <div className="model3d-inner">
      <aside className="model3d-sidebar">
        <p className="model3d-label">豆包 Seed3D</p>
        <p>状态 <strong>{model3d.status}</strong></p>
        {model3d.taskId && <p className="mono-sm">ID {model3d.taskId}</p>}
        {model3d.message && <p>{model3d.message}</p>}
        {model3d.loading && <p className="loading-text">生成中…</p>}
        {model3d.modelUrl && (
          <a className="text-link" href={model3d.modelUrl} target="_blank" rel="noreferrer">
            下载 {model3d.fileFormat.toUpperCase()}
          </a>
        )}
      </aside>
      <div ref={containerRef} className="model3d-viewport">
        {!model3d.modelUrl && !model3d.loading && (
          <p className="viewport-placeholder">说：「把当前图生成 3D 模型」</p>
        )}
      </div>
    </div>
  )
}
