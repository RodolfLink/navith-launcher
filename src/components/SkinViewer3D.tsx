import React, { useEffect, useRef, useState } from 'react';
import { SkinViewer, WalkingAnimation, RunningAnimation, FlyingAnimation, IdleAnimation } from 'skinview3d';

interface Props {
  skinUrl: string;
  capeUrl?: string;
  model?: 'classic' | 'slim';
  width?: number;
  height?: number;
  isStatic?: boolean;
  animation?: 'idle' | 'walk' | 'run' | 'fly' | 'none';
  autoRotate?: boolean;
  outerLayer?: boolean;
}

const ANIMATIONS: Record<string, any> = {
  idle: IdleAnimation,
  walk: WalkingAnimation,
  run: RunningAnimation,
  fly: FlyingAnimation
};

const SkinViewer3D: React.FC<Props> = ({
  skinUrl,
  capeUrl,
  model = 'classic',
  width = 300,
  height = 400,
  isStatic = false,
  animation = 'idle',
  autoRotate = true,
  outerLayer = true
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const presentationRef = useRef({ animation, autoRotate });
  const syncPresentationRef = useRef<() => void>(() => {});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  presentationRef.current = { animation, autoRotate };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !skinUrl) return;

    let viewer: SkinViewer | null = null;
    let isIntersecting = false;
    let isDisposed = false;
    let pageInactive = document.hidden || !document.hasFocus();
    let currentAnimation: string | null = null;
    setErrorMsg(null);

    const syncViewerActivity = () => {
      if (!viewer) return;
      const presentation = presentationRef.current;
      viewer.autoRotate = !isStatic && presentation.autoRotate;
      viewer.autoRotateSpeed = 0.65;

      if (isStatic) {
        viewer.controls.enableRotate = false;
        viewer.controls.enableZoom = false;
        viewer.controls.enablePan = false;
      } else {
        viewer.controls.enableRotate = true;
        viewer.controls.enableZoom = false;
        viewer.controls.enablePan = false;
        if (currentAnimation !== presentation.animation) {
          const AnimationClass = ANIMATIONS[presentation.animation];
          viewer.animation = AnimationClass ? new AnimationClass() : null;
          currentAnimation = presentation.animation;
        }
      }

      const shouldPause = isStatic || pageInactive || !isIntersecting;
      viewer.renderPaused = shouldPause;
      if (viewer.animation) viewer.animation.paused = shouldPause;
    };
    syncPresentationRef.current = syncViewerActivity;

    const createViewer = () => {
      if (viewer || isDisposed || !isIntersecting) return;

      try {
        viewer = new SkinViewer({ canvas, width, height, pixelRatio: 1, renderPaused: true });
        currentAnimation = null;
        if (isStatic) {
          viewer.camera.position.set(0, 0, 44);
          viewer.camera.rotation.set(0, 0, 0);
        }
        const currentViewer = viewer;
        const skinLoad = Promise.resolve(currentViewer.loadSkin(skinUrl, { model: model === 'slim' ? 'slim' : 'default' }));
        const capeLoad = capeUrl ? Promise.resolve(currentViewer.loadCape(capeUrl)) : Promise.resolve();

        Promise.all([skinLoad, capeLoad]).then(() => {
          if (isDisposed || viewer !== currentViewer) return;
          const playerSkin = currentViewer.playerObject.skin as any;
          if (playerSkin?.innerLayer) playerSkin.innerLayer.visible = true;
          if (playerSkin?.outerLayer) playerSkin.outerLayer.visible = outerLayer;
          syncViewerActivity();
          if (isStatic && isIntersecting) currentViewer.render();
        }).catch((error: any) => {
          if (isDisposed || viewer !== currentViewer) return;
          console.warn('Aviso al cargar skin 3D:', error);
          setErrorMsg(error?.message || 'No se pudo cargar esta skin.');
        });

        syncViewerActivity();
      } catch (error: any) {
        console.error('Error en SkinViewer3D:', error);
        setErrorMsg(error?.message || String(error));
      }
    };

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      isIntersecting = !!entries[0]?.isIntersecting;
      if (isStatic && !isIntersecting && viewer) {
        viewer.dispose();
        viewer = null;
        currentAnimation = null;
      } else if (isIntersecting) {
        createViewer();
      }
      syncViewerActivity();
    };

    const handleWindowActivity = () => {
      pageInactive = document.hidden || !document.hasFocus();
      syncViewerActivity();
    };

    document.addEventListener('visibilitychange', handleWindowActivity);
    window.addEventListener('blur', handleWindowActivity);
    window.addEventListener('focus', handleWindowActivity);

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(handleIntersection, { rootMargin: '100px', threshold: 0.01 });
      observer.observe(canvas);
    } else {
      isIntersecting = true;
      createViewer();
    }

    return () => {
      isDisposed = true;
      observer?.disconnect();
      document.removeEventListener('visibilitychange', handleWindowActivity);
      window.removeEventListener('blur', handleWindowActivity);
      window.removeEventListener('focus', handleWindowActivity);
      try {
        viewer?.dispose();
      } catch (error) {
        console.warn('No se pudo liberar el visor de skin:', error);
      }
      viewer = null;
      syncPresentationRef.current = () => {};
    };
  }, [skinUrl, capeUrl, model, width, height, isStatic, outerLayer]);

  useEffect(() => {
    syncPresentationRef.current();
  }, [animation, autoRotate]);

  if (errorMsg) {
    return (
      <div className="skin-error-placeholder" role="status">
        <p>No se pudo mostrar la skin en 3D</p>
        <img src={skinUrl} alt="Vista previa de la skin" />
      </div>
    );
  }

  return (
    <div className="skin-viewer-wrapper">
      <canvas ref={canvasRef} width={width} height={height} aria-label="Vista previa 3D de la skin" />
    </div>
  );
};

export default SkinViewer3D;
