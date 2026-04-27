'use client'
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';

export default function IcosahedronScene() {
    const containerRef = useRef(null);
    const sceneRef = useRef({});

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Scene setup
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
        camera.position.set(0, 0, 5);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;
        container.appendChild(renderer.domElement);

        // Lighting - dramatic stage lighting from top-right
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        scene.add(ambientLight);

        const spotLight = new THREE.SpotLight(0xffffff, 2.5);
        spotLight.position.set(5, 8, 5);
        spotLight.angle = 0.25;
        spotLight.penumbra = 0.8;
        spotLight.castShadow = true;
        scene.add(spotLight);

        const rimLight = new THREE.PointLight(0x0033ff, 1.5, 20);
        rimLight.position.set(-4, -2, 3);
        scene.add(rimLight);

        const fillLight = new THREE.PointLight(0xffffff, 0.6, 20);
        fillLight.position.set(0, -5, 2);
        scene.add(fillLight);

        // Create the icosahedron with frosted glass / metallic look
        const geometry = new THREE.IcosahedronGeometry(1.4, 1);
        const material = new THREE.MeshPhysicalMaterial({
            color: 0x1a1a2e,
            metalness: 0.95,
            roughness: 0.08,
            clearcoat: 1.0,
            clearcoatRoughness: 0.15,
            reflectivity: 1,
            envMapIntensity: 1.5,
        });

        const icosahedron = new THREE.Mesh(geometry, material);
        scene.add(icosahedron);

        // Wireframe overlay for the "vault" feel
        const wireGeo = new THREE.IcosahedronGeometry(1.42, 1);
        const wireMat = new THREE.MeshBasicMaterial({
            color: 0x0033ff,
            wireframe: true,
            transparent: true,
            opacity: 0.12,
        });
        const wireframe = new THREE.Mesh(wireGeo, wireMat);
        scene.add(wireframe);

        // Outer ring particles
        const particleCount = 120;
        const particleGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            const radius = 2.2 + Math.random() * 0.3;
            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
            positions[i * 3 + 2] = Math.sin(angle) * radius;
        }
        particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const particleMat = new THREE.PointsMaterial({
            color: 0x0033ff,
            size: 0.015,
            transparent: true,
            opacity: 0.6,
        });
        const particles = new THREE.Points(particleGeo, particleMat);
        scene.add(particles);

        // Store refs for hover interaction
        sceneRef.current = { icosahedron, wireframe, particles, hoverSpeed: 1 };

        // Animation
        let animationId;
        const clock = new THREE.Clock();

        const animate = () => {
            animationId = requestAnimationFrame(animate);
            const elapsed = clock.getElapsedTime();
            const speed = sceneRef.current.hoverSpeed;

            // Slow, tilted rotation
            icosahedron.rotation.x = elapsed * 0.15 * speed + 0.26;
            icosahedron.rotation.y = elapsed * 0.25 * speed;

            wireframe.rotation.x = icosahedron.rotation.x;
            wireframe.rotation.y = icosahedron.rotation.y;

            // Floating motion
            icosahedron.position.y = Math.sin(elapsed * 0.6) * 0.12;
            wireframe.position.y = icosahedron.position.y;

            // Particle ring rotation
            particles.rotation.y = elapsed * 0.08 * speed;
            particles.rotation.x = Math.sin(elapsed * 0.3) * 0.05;

            // Subtle cobalt pulse on wireframe
            wireMat.opacity = 0.08 + Math.sin(elapsed * 1.5) * 0.04;

            renderer.render(scene, camera);
        };
        animate();

        // Handle resize
        const handleResize = () => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            cancelAnimationFrame(animationId);
            window.removeEventListener('resize', handleResize);
            renderer.dispose();
            geometry.dispose();
            material.dispose();
            wireGeo.dispose();
            wireMat.dispose();
            particleGeo.dispose();
            particleMat.dispose();
            if (container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }
        };
    }, []);

    // Hover handlers to speed up rotation
    const handleMouseEnter = () => {
        if (sceneRef.current) sceneRef.current.hoverSpeed = 2.5;
    };
    const handleMouseLeave = () => {
        if (sceneRef.current) sceneRef.current.hoverSpeed = 1;
    };

    return (
        <div
            ref={containerRef}
            className="w-full h-full"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        />
    );
}