// React hooks.
import { useEffect, useRef, useState } from 'react';

// Vertex shader: a full-screen triangle.
const vertex = `attribute vec2 a_position;
void main(){gl_Position=vec4(a_position,0.0,1.0);}`;
// Fragment shader (GLSL) that draws an animated silver ring; its parts are annotated below.
const fragment = `#ifdef GL_FRAGMENT_PRECISION_HIGH
// Use high precision floats where supported.
precision highp float;
#else
precision mediump float;
#endif
// Canvas size in pixels.
uniform vec2 u_resolution;
// Pointer position (0 to 1).
uniform vec2 u_pointer;
// Time in seconds.
uniform float u_time;
// Blend between sign-in (0) and workspace (1) looks.
uniform float u_workspace;
// Entry point of the shader.
void main(){
  // Normalized pixel position.
  vec2 uv=gl_FragCoord.xy/u_resolution;
  // Aspect ratio.
  float aspect=u_resolution.x/u_resolution.y;
  // Ring center, moving between the two scenes.
  vec2 center=mix(vec2(0.43,0.47),vec2(0.77,0.86),u_workspace);
  // Centered, aspect-corrected coordinates.
  vec2 p=(uv-center)*vec2(aspect,1.0)*2.0;
  // Shift slightly with the pointer.
  p-=(u_pointer-0.5)*0.09;
  // Slowly oscillating tilt.
  float tilt=-0.36+sin(u_time*0.12)*0.06;
  // Rotate coordinates by the tilt.
  p=mat2(cos(tilt),-sin(tilt),sin(tilt),cos(tilt))*p;
  // Squash the ring horizontally.
  p.x*=0.80;
  // Angle around the center.
  float angle=atan(p.y,p.x);
  // Distance from the center.
  float radius=length(p);
  // Wavy distortion of the ring.
  float wave=sin(angle*3.0+u_time*0.26)*0.052+sin(angle*5.0-u_time*0.19)*0.016;
  // Ring radius with the distortion.
  float ring=0.68+wave;
  // Varying ring thickness.
  float thickness=0.15+0.024*sin(angle*2.0+u_time*0.1);
  // Position across the ring tube (-1 to 1).
  float cross=(radius-ring)/thickness;
  // Soft-edged mask of the ring.
  float body=1.0-smoothstep(0.97,1.015,abs(cross));
  // Fake tube depth (a half-circle profile).
  float depth=sqrt(max(0.0,1.0-cross*cross));
  // Direction from the center.
  vec2 radial=normalize(p+0.0001);
  // Surface normal for shading.
  vec3 normal=normalize(vec3(radial*clamp(cross,-1.0,1.0),depth));
  // Light direction.
  vec3 light=normalize(vec3(-0.55,0.65,0.78));
  // Diffuse lighting.
  float diffuse=max(0.0,dot(normal,light));
  // Specular highlight.
  float shine=pow(max(0.0,dot(reflect(-light,normal),vec3(0.0,0.0,1.0))),24.0);
  // Dark seam at the edges.
  float seam=pow(1.0-depth,7.0)*0.65;
  // Moving ribbon pattern.
  float ribbon=pow(0.5+0.5*sin(cross*6.0+angle*1.8+u_time*0.19),10.0);
  // Combine into a silver brightness.
  float silver=0.035+diffuse*0.12+shine*0.95+seam+ribbon*0.21;
  // Faint outer glow.
  float outer=exp(-abs(radius-ring)*19.0)*0.022;
  // Dim background gradient.
  float room=0.013+0.008*(1.0-uv.y);
  // Final brightness.
  float value=room+outer+body*silver;
  // Dim the effect in the workspace view.
  value=mix(value,room+(value-room)*0.38,u_workspace);
  // Output a gray color.
  gl_FragColor=vec4(vec3(value),1.0);
}`;

// Animated WebGL background component (static fallback if WebGL is unavailable).
export default function LiquidBackdrop({ playing, workspace }: { playing: boolean; workspace: boolean }) {
  // Reference to the canvas element.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Current smoothed pointer position.
  const pointer = useRef([0.5, 0.5]);
  // Target pointer position.
  const targetPointer = useRef([0.5, 0.5]);
  // Latest props, readable inside the animation loop.
  const controls = useRef({ playing, workspace });
  // Function that requests a redraw.
  const redraw = useRef<(() => void) | null>(null);
  // Update the controls when props change and redraw.
  useEffect(() => { controls.current = { playing, workspace }; redraw.current?.(); }, [playing, workspace]);
  // Animation time (starts at 8 s).
  const phase = useRef(8);
  // Whether WebGL works.
  const [supported, setSupported] = useState(true);
  // Set up WebGL once on mount.
  useEffect(() => {
    // Get the canvas.
    const canvas = canvasRef.current!;
    // Create a low-power WebGL context.
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
    // No WebGL: use the static fallback.
    if (!gl) { setSupported(false); return; }
    // Helper that compiles a shader.
    const compile = (type: number, source: string) => {
      // Create, set the source, and compile.
      const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
      // On a compile failure, delete it and throw.
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Shader unavailable'); }
      // Return the shader.
      return shader;
    };
    // Track created resources for cleanup.
    let shaders: WebGLShader[] = []; let program: WebGLProgram | null = null; let buffer: WebGLBuffer | null = null;
    // Build the program (errors caught below).
    try {
      // Compile both shaders.
      shaders.push(compile(gl.VERTEX_SHADER, vertex)); shaders.push(compile(gl.FRAGMENT_SHADER, fragment));
      // Create, attach, and link the program.
      program = gl.createProgram()!; shaders.forEach(shader => gl.attachShader(program!, shader)); gl.linkProgram(program);
      // Fail if linking failed.
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader unavailable');
      // Use the program and create a buffer.
      gl.useProgram(program); buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      // Upload one triangle that covers the screen.
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      // Wire the buffer to the position attribute.
      const position = gl.getAttribLocation(program, 'a_position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      // Mark WebGL as supported.
      setSupported(true);
    // On failure, clean up everything.
    } catch {
      // Delete the resources.
      shaders.forEach(shader => gl.deleteShader(shader)); if (program) gl.deleteProgram(program); if (buffer) gl.deleteBuffer(buffer);
      // Use the fallback and stop.
      setSupported(false); return;
    }
    // Locations of the shader uniforms: resolution.
    const resolution = gl.getUniformLocation(program!, 'u_resolution');
    // Pointer.
    const mouse = gl.getUniformLocation(program!, 'u_pointer');
    // Time.
    const time = gl.getUniformLocation(program!, 'u_time');
    // Scene blend.
    const scene = gl.getUniformLocation(program!, 'u_workspace');
    // Current blend (smoothly approaches the target).
    let blend = controls.current.workspace ? 1 : 0;
    // Query the reduced-motion preference.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    // Animation state: frame id, last timestamp, visibility, and context loss.
    let frame = 0; let last: number | null = null; let visible = true; let lost = false;
    // Draw one frame.
    const draw = (stamp: number) => {
      // Stop if the context is lost, the tab is hidden, or the canvas is off-screen.
      frame = 0; if (lost || document.hidden || !visible) { last = null; return; }
      // Cap animation at roughly 30 frames per second: skip this tick if the last draw was under 30 ms ago.
      if (last !== null && stamp - last < 30 && controls.current.playing && !reduced.matches) { frame = requestAnimationFrame(draw); return; }
      // Time since the last frame (capped at 50 ms).
      const delta = last === null ? 0 : Math.min(Math.max((stamp - last) / 1000, 0), 0.05);
      // Remember this frame's time.
      last = stamp;
      // Animate only when effects are on and motion is not reduced.
      const moving = controls.current.playing && !reduced.matches;
      // Target scene blend.
      const destination = controls.current.workspace ? 1 : 0;
      // When animating:
      if (moving) {
        // Advance time.
        phase.current += delta;
        // Smoothing factor for the pointer.
        const follow = 1 - Math.exp(-6 * delta);
        // Ease the pointer horizontally.
        pointer.current[0] += (targetPointer.current[0] - pointer.current[0]) * follow;
        // Ease the pointer vertically.
        pointer.current[1] += (targetPointer.current[1] - pointer.current[1]) * follow;
        // Ease the scene blend.
        blend += (destination - blend) * (1 - Math.exp(-4 * delta));
      // Otherwise jump to the final blend.
      } else blend = destination;
      // Set the viewport.
      gl.viewport(0, 0, canvas.width, canvas.height);
      // Send the size and pointer to the shader.
      gl.uniform2f(resolution, canvas.width, canvas.height); gl.uniform2f(mouse, pointer.current[0], pointer.current[1]);
      // Send the time and blend, then draw.
      gl.uniform1f(time, phase.current); gl.uniform1f(scene, blend); gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Keep animating.
      if (moving) frame = requestAnimationFrame(draw);
      // Otherwise reset the timer.
      else last = null;
    };
    // Schedule a frame if none is pending.
    const schedule = () => { if (!frame && !lost && visible && !document.hidden) frame = requestAnimationFrame(draw); };
    // Expose it so props changes can redraw.
    redraw.current = schedule;
    // Resize the canvas.
    const resize = () => {
      // Render at half resolution or less: the backdrop is a soft glow, so this saves most of the GPU work.
      const bounds = canvas.getBoundingClientRect(); const dpr = Math.min(devicePixelRatio || 1, 0.5, 800 / Math.max(bounds.width, 1));
      // Compute the pixel size.
      const width = Math.max(1, Math.round(bounds.width * dpr)); const height = Math.max(1, Math.round(bounds.height * dpr));
      // Update the canvas size if needed.
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      // Redraw.
      schedule();
    };
    // Pointer handler: update the target position.
    const move = (event: PointerEvent) => {
      // Ignore when disabled, hidden, or off-screen.
      if (reduced.matches || !controls.current.playing || document.hidden || !visible) return;
      // Normalize the pointer coordinates to 0-1.
      targetPointer.current = [Math.min(1, Math.max(0, event.clientX / innerWidth)), Math.min(1, Math.max(0, 1 - event.clientY / innerHeight))];
      // Redraw.
      schedule();
    };
    // Restart or stop the loop when visibility changes.
    const visibility = () => { cancelAnimationFrame(frame); frame = 0; last = null; schedule(); };
    // On context loss, switch to the static fallback.
    const loss = (event: Event) => { event.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0; setSupported(false); };
    // Watch canvas size changes.
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    // Watch whether the canvas is on-screen.
    const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; visibility(); }); intersection.observe(canvas);
    // Register the pointer, visibility, and motion-preference listeners.
    window.addEventListener('pointermove', move, { passive: true }); document.addEventListener('visibilitychange', visibility); reduced.addEventListener('change', visibility);
    // Register context loss and do the first resize.
    canvas.addEventListener('webglcontextlost', loss); resize();
    // Cleanup when the component unmounts.
    return () => {
      // Stop the animation and remove observers and listeners.
      redraw.current = null; cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect(); window.removeEventListener('pointermove', move);
      // Remove the remaining listeners.
      document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', visibility); canvas.removeEventListener('webglcontextlost', loss);
      // Delete the WebGL resources.
      shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteBuffer(buffer); gl.deleteProgram(program);
    };
  }, []);
  // Render the canvas (a static style is used when WebGL is unavailable).
  return <div className={`liquid-backdrop ${supported ? '' : 'static-light'}`} aria-hidden="true"><canvas ref={canvasRef} className={supported ? '' : 'unavailable'} /></div>;
}
