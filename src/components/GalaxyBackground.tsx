import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

const GalaxyBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.03);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 10, 0);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false, // Antialias innecesario para partículas de puntos, ahorra ~40MB de GPU
      powerPreference: 'low-power'
    });
    const updateRendererSize = () => {
      renderer.setPixelRatio(1);
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    updateRendererSize();

    const parameters = {
      count: 12000,
      size: 0.022,
      radius: 8,
      branches: 4,
      spin: 1,
      randomness: 0.3,
      randomnessPower: 3,
      insideColor: '#b100ff',
      outsideColor: '#0088ff',
    };

    let geometry: THREE.BufferGeometry | null = null;
    let material: THREE.PointsMaterial | null = null;
    let points: THREE.Points | null = null;
    let starGeo: THREE.BufferGeometry | null = null;
    let starMat: THREE.PointsMaterial | null = null;

    const generateGalaxy = () => {
      if (points !== null) {
        geometry?.dispose();
        material?.dispose();
        scene.remove(points);
      }

      geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(parameters.count * 3);
      const colors = new Float32Array(parameters.count * 3);
      const colorInside = new THREE.Color(parameters.insideColor);
      const colorOutside = new THREE.Color(parameters.outsideColor);
      const mixedColor = colorInside.clone();

      for (let i = 0; i < parameters.count; i++) {
        const i3 = i * 3;

        let radius = Math.random() * parameters.radius;
        if (radius < 0.5) radius += 0.5;

        const spinAngle = radius * parameters.spin;
        const branchAngle = (i % parameters.branches) / parameters.branches * Math.PI * 2;

        const randomX = Math.pow(Math.random(), parameters.randomnessPower) * (Math.random() < 0.5 ? 1 : -1) * parameters.randomness * radius;
        const randomY = Math.pow(Math.random(), parameters.randomnessPower) * (Math.random() < 0.5 ? 1 : -1) * parameters.randomness * radius;
        const randomZ = Math.pow(Math.random(), parameters.randomnessPower) * (Math.random() < 0.5 ? 1 : -1) * parameters.randomness * radius;

        const x = Math.cos(branchAngle + spinAngle) * radius + randomX;
        const y = randomY / 2;
        const z = Math.sin(branchAngle + spinAngle) * radius + randomZ;

        positions[i3] = x;
        positions[i3 + 1] = y;
        positions[i3 + 2] = z;

        mixedColor.copy(colorInside).lerp(colorOutside, radius / parameters.radius);

        colors[i3] = mixedColor.r;
        colors[i3 + 1] = mixedColor.g;
        colors[i3 + 2] = mixedColor.b;
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      material = new THREE.PointsMaterial({
        size: parameters.size,
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true
      });

      points = new THREE.Points(geometry, material);
      scene.add(points);
    };

    const generateBgStars = () => {
      starGeo = new THREE.BufferGeometry();
      const starCount = 800;
      const starPositions = new Float32Array(starCount * 3);

      for (let i = 0; i < starCount; i++) {
        const i3 = i * 3;
        const r = 15 + Math.random() * 90;
        const theta = 2 * Math.PI * Math.random();
        const phi = Math.acos(2 * Math.random() - 1);

        starPositions[i3] = r * Math.sin(phi) * Math.cos(theta);
        starPositions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        starPositions[i3 + 2] = r * Math.cos(phi);
      }

      starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
      starMat = new THREE.PointsMaterial({
        color: 0x888888,
        size: 0.03,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.5,
        depthWrite: false
      });

      const stars = new THREE.Points(starGeo, starMat);
      scene.add(stars);
    };

    generateGalaxy();
    generateBgStars();

    let animationFrameId: number | null = null;
    let lastFrameTime = 0;
    let elapsedTime = 0;
    let isPaused = document.hidden || !document.hasFocus();

    const tick = (timestamp: number) => {
      animationFrameId = null;
      if (isPaused) return;

      if (lastFrameTime > 0) {
        elapsedTime += (timestamp - lastFrameTime) / 1000;
      }
      lastFrameTime = timestamp;

      if (points) {
        points.rotation.y = elapsedTime * 0.05;
      }
      renderer.render(scene, camera);
      animationFrameId = window.requestAnimationFrame(tick);
    };

    const startRendering = () => {
      if (!isPaused && animationFrameId === null) {
        animationFrameId = window.requestAnimationFrame(tick);
      }
    };

    const syncActivity = () => {
      const shouldPause = document.hidden || !document.hasFocus();
      if (shouldPause === isPaused) return;
      isPaused = shouldPause;

      if (isPaused) {
        if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        lastFrameTime = 0;
      } else {
        lastFrameTime = 0;
        startRendering();
      }
    };

    document.addEventListener('visibilitychange', syncActivity);
    window.addEventListener('blur', syncActivity);
    window.addEventListener('focus', syncActivity);
    startRendering();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      updateRendererSize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('visibilitychange', syncActivity);
      window.removeEventListener('blur', syncActivity);
      window.removeEventListener('focus', syncActivity);
      window.removeEventListener('resize', handleResize);
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
      geometry?.dispose();
      material?.dispose();
      starGeo?.dispose();
      starMat?.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <canvas 
      ref={canvasRef} 
      style={{ 
        position: 'fixed', 
        inset: 0, 
        width: '100vw', 
        height: '100vh', 
        zIndex: 0, 
        pointerEvents: 'none' 
      }} 
    />
  );
};

export default React.memo(GalaxyBackground);
