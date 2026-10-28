import React, { useEffect, useRef } from 'react';
import { SkinViewer } from 'skinview3d';

interface Props {
  capeUrl: string;
  width?: number;
  height?: number;
}

const INVISIBLE_SKIN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAPElEQVR42u3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8G8As4EAAf6S97MAAAAASUVORK5CYII=';

const CapeViewer3D: React.FC<Props> = ({ capeUrl, width = 100, height = 150 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !capeUrl) return;

    let viewer: SkinViewer | null = null;
    let observer: IntersectionObserver | null = null;
    let intersecting = false;
    let pageActive = !document.hidden && document.hasFocus();
    let frameId: number | null = null;
    let lastFrame = 0;
    let elapsed = 0;
    let disposed = false;

    const stopAnimation = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = null;
      lastFrame = 0;
    };

    const animate = (timestamp: number) => {
      frameId = null;
      if (disposed || !viewer || !intersecting || !pageActive) return;

      if (lastFrame) elapsed += Math.min(timestamp - lastFrame, 50) / 1000;
      lastFrame = timestamp;
      if (viewer.playerObject) viewer.playerObject.rotation.y = Math.sin(elapsed * 1.15) * 0.16;
      viewer.render();
      frameId = window.requestAnimationFrame(animate);
    };

    const syncActivity = () => {
      pageActive = !document.hidden && document.hasFocus();
      if (!intersecting || !pageActive || !viewer) {
        stopAnimation();
        if (viewer) viewer.renderPaused = true;
      } else {
        viewer.renderPaused = true; // El render manual evita dejar un segundo bucle activo.
        if (frameId === null) frameId = window.requestAnimationFrame(animate);
      }
    };

    const createViewer = () => {
      if (viewer || disposed || !intersecting) return;
      try {
        const instance = new SkinViewer({ canvas, width, height, pixelRatio: 1, renderPaused: true });
        viewer = instance;
        instance.camera.position.set(0, 8, -38);
        instance.camera.lookAt(0, 8, 0);
        instance.autoRotate = false;
        instance.controls.enableRotate = true;
        instance.controls.enableZoom = false;
        instance.controls.enablePan = false;

        Promise.allSettled([
          Promise.resolve(instance.loadSkin(INVISIBLE_SKIN)),
          Promise.resolve(instance.loadCape(capeUrl))
        ]).then(() => {
          if (!disposed && viewer === instance) syncActivity();
        });
        syncActivity();
      } catch (error) {
        console.warn('No se pudo crear la vista previa de la capa:', error);
      }
    };

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      intersecting = !!entries[0]?.isIntersecting;
      if (intersecting) {
        createViewer();
        syncActivity();
      } else {
        stopAnimation();
        if (viewer) {
          viewer.dispose();
          viewer = null;
        }
      }
    };

    const handleWindowActivity = () => syncActivity();
    document.addEventListener('visibilitychange', handleWindowActivity);
    window.addEventListener('blur', handleWindowActivity);
    window.addEventListener('focus', handleWindowActivity);

    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(handleIntersection, { rootMargin: '80px', threshold: 0.05 });
      observer.observe(canvas);
    } else {
      intersecting = true;
      createViewer();
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      document.removeEventListener('visibilitychange', handleWindowActivity);
      window.removeEventListener('blur', handleWindowActivity);
      window.removeEventListener('focus', handleWindowActivity);
      stopAnimation();
      viewer?.dispose();
      viewer = null;
    };
  }, [capeUrl, width, height]);

  return (
    <div className="cape-3d-preview">
      <canvas ref={canvasRef} width={width} height={height} aria-label="Vista previa 3D de la capa" />
    </div>
  );
};

export default React.memo(CapeViewer3D);
