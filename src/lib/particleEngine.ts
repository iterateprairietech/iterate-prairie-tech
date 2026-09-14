export type SampleSource = HTMLImageElement | HTMLCanvasElement;
export type SampleMode = 'shape' | 'photo';
export type SampleAlign = 'center' | 'left' | 'right';
export type SampleVAlign = 'center' | 'upper';

export interface ParticleEngineOptions {
	canvas: HTMLCanvasElement;
	burstCanvas?: HTMLCanvasElement | null;
	groundAware?: boolean;
	scrollSpread?: boolean;
	pointerRoot?: Document | HTMLElement;
	touchDrag?: boolean;
	clickBurst?: boolean;
	scatter?: boolean;
	pickColor?: () => string;
	getSpreadTarget?: () => number;
}

type ShapeKind = 'rect' | 'circle' | 'tri' | 'diamond';

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	tx: number;
	ty: number;
	phase: number;
	c: string;
	s: number;
	kind?: ShapeKind;
	rot?: number;
	rotV?: number;
}

interface Burst {
	x: number;
	y: number;
	vx: number;
	vy: number;
	s: number;
	c: string;
}

const BASE_ROT = -0.0006;
const FAST_ROT = -0.0018;
const BASE_WANDER = 1.2;
const FAST_WANDER = 3.5;
const RAMP = 0.04;
const MAX_SPREAD_DIST = 0.22;
const CREAM = '#F2EFEB';
const CHARCOAL = '#2C2C2A';

export function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const im = new Image();
		im.onload = () => resolve(im);
		im.onerror = reject;
		im.src = src;
	});
}

export function defaultPickColor(): string {
	const r = Math.random();
	if (r < 0.04) return '#38B6FF';
	if (r < 0.16) return '#FF7870';
	return CHARCOAL;
}

export function createParticleEngine(opts: ParticleEngineOptions) {
	const cv = opts.canvas;
	const burstCv = opts.burstCanvas ?? null;
	const ctx = cv.getContext('2d');
	if (!ctx) throw new Error('particle canvas 2d context not available');
	const bctx = burstCv?.getContext('2d') ?? null;

	const groundAware = opts.groundAware ?? false;
	const scrollSpread = opts.scrollSpread ?? false;
	const scatter = opts.scatter ?? false;
	const pickColor = opts.pickColor ?? defaultPickColor;
	const footerEl = groundAware ? document.querySelector<HTMLElement>('[data-footer]') : null;

	let particles: Particle[] = [];
	let bursts: Burst[] = [];
	let W = 0;
	let H = 0;
	let formCx = 0;
	let formCy = 0;
	let spinEnabled = !scatter;
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	let running = false;
	let raf = 0;
	let rotation = 0;
	let rotSpeed = BASE_ROT;
	let rotSpeedTarget = BASE_ROT;
	let wander = BASE_WANDER;
	let wanderTarget = BASE_WANDER;
	let spread = 0;
	let time = 0;
	const mouse = { x: -9999, y: -9999 };
	let moveTimer: ReturnType<typeof setTimeout> | null = null;

	let currentSource: SampleSource | null = null;
	let currentMode: SampleMode = 'shape';
	let currentAlign: SampleAlign = 'center';
	let currentVAlign: SampleVAlign = 'center';

	function sourceSize(source: SampleSource): { sw: number; sh: number } {
		if (source instanceof HTMLCanvasElement) {
			return { sw: source.width, sh: source.height };
		}
		return { sw: source.naturalWidth, sh: source.naturalHeight };
	}

	function sampleImage(
		source: SampleSource | null = currentSource,
		mode: SampleMode = currentMode,
		morph = true,
		align: SampleAlign = currentAlign,
		vAlign: SampleVAlign = currentVAlign,
	) {
		if (!source || !W || !H) return;

		const { sw, sh } = sourceSize(source);
		if (!sw || !sh) return;

		currentSource = source;
		currentMode = mode;
		currentAlign = align;
		currentVAlign = vAlign;

		const narrow = window.matchMedia('(max-width: 820px)').matches;
		const alignEff: SampleAlign = narrow ? 'center' : align;
		const imgSize =
			alignEff === 'center'
				? Math.round(Math.min(W, H) * 1.0)
				: Math.round(Math.min(W * 0.48, H) * 0.78);
		const srcAspect = sw / sh;

		let dw: number;
		let dh: number;
		let dx: number;
		let dy: number;
		if (srcAspect > 1) {
			dw = imgSize;
			dh = Math.round(imgSize / srcAspect);
			dx = 0;
			dy = Math.round((imgSize - dh) / 2);
		} else {
			dh = imgSize;
			dw = Math.round(imgSize * srcAspect);
			dy = 0;
			dx = Math.round((imgSize - dw) / 2);
		}

		const off = document.createElement('canvas');
		off.width = imgSize;
		off.height = imgSize;
		const octx = off.getContext('2d')!;
		octx.clearRect(0, 0, imgSize, imgSize);
		octx.drawImage(source, 0, 0, sw, sh, dx, dy, dw, dh);
		const data = octx.getImageData(0, 0, imgSize, imgSize).data;

		const mob = W < 768;
		const gap = mob ? 4 : 3;

		let ox: number;
		if (alignEff === 'left') ox = (W * 0.5 - imgSize) / 2;
		else if (alignEff === 'right') ox = W * 0.5 + (W * 0.5 - imgSize) / 2;
		else ox = (W - imgSize) / 2;
		const oy = vAlign === 'upper' ? Math.round(H * 0.3 - imgSize / 2) : (H - imgSize) / 2;
		formCx = ox + imgSize / 2;
		formCy = oy + imgSize / 2;

		const next: Particle[] = [];
		for (let py = dy; py < dy + dh; py += gap) {
			for (let px = dx; px < dx + dw; px += gap) {
				const i = (py * imgSize + px) * 4;
				const a = data[i + 3];
				let c: string | null = null;
				if (mode === 'shape') {
					if (a > 128) c = pickColor();
				} else if (a > 0) {
					c = `rgb(${data[i]}, ${data[i + 1]}, ${data[i + 2]})`;
				}
				if (c === null) continue;
				next.push({
					x: Math.random() * W,
					y: Math.random() * H,
					vx: 0,
					vy: 0,
					tx: ox + px,
					ty: oy + py,
					phase: Math.random() * Math.PI * 2,
					c,
					s: mob ? Math.random() * 2.0 + 2.5 : Math.random() * 1.8 + 2.2,
				});
			}
		}

		if (next.length > 5200) {
			const skip = Math.ceil(next.length / 5200);
			const kept = next.filter((_, i) => i % skip === 0);
			next.length = 0;
			next.push(...kept);
		}

		if (!morph || particles.length === 0) {
			particles = next;
			return;
		}

		const donorCount = particles.length;
		for (let i = 0; i < next.length; i++) {
			if (i < donorCount) {
				particles[i].tx = next[i].tx;
				particles[i].ty = next[i].ty;
				particles[i].c = next[i].c;
				particles[i].s = next[i].s;
			} else {
				particles.push({ ...next[i] });
			}
		}
		particles.length = next.length;
	}

	function resize() {
		const rect = cv.getBoundingClientRect();
		W = Math.round(rect.width);
		H = Math.round(rect.height);
		if (W === 0 || H === 0) return;
		cv.width = Math.round(W * dpr);
		cv.height = Math.round(H * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (burstCv && bctx) {
			burstCv.width = Math.round(W * dpr);
			burstCv.height = Math.round(H * dpr);
			bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
		if (scatter) seedScatter();
	}

	function seedScatter() {
		if (!W || !H) return;
		const n = W < 768 ? 40 : 70;
		const kinds: ShapeKind[] = ['rect', 'circle', 'tri', 'diamond'];
		particles = [];
		for (let i = 0; i < n; i++) {
			particles.push({
				x: Math.random() * W,
				y: Math.random() * H,
				vx: (Math.random() - 0.5) * 0.65,
				vy: (Math.random() - 0.5) * 0.65,
				tx: 0,
				ty: 0,
				phase: Math.random() * Math.PI * 2,
				c: pickColor(),
				s: 6 + Math.random() * 26,
				kind: kinds[Math.floor(Math.random() * kinds.length)],
				rot: Math.random() * Math.PI * 2,
				rotV: (Math.random() - 0.5) * 0.025,
			});
		}
	}

	function drawShape(p: Particle, fill: string, alpha: number) {
		ctx.save();
		ctx.translate(p.x, p.y);
		ctx.rotate(p.rot ?? 0);
		ctx.globalAlpha = alpha;
		ctx.fillStyle = fill;
		const s = p.s;
		if (p.kind === 'circle') {
			ctx.beginPath();
			ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
			ctx.fill();
		} else if (p.kind === 'tri') {
			ctx.beginPath();
			ctx.moveTo(0, -s / 2);
			ctx.lineTo(s / 2, s / 2);
			ctx.lineTo(-s / 2, s / 2);
			ctx.closePath();
			ctx.fill();
		} else if (p.kind === 'diamond') {
			ctx.beginPath();
			ctx.moveTo(0, -s / 2);
			ctx.lineTo(s / 2, 0);
			ctx.lineTo(0, s / 2);
			ctx.lineTo(-s / 2, 0);
			ctx.closePath();
			ctx.fill();
		} else {
			ctx.fillRect(-s / 2, -s / 2, s, s);
		}
		ctx.restore();
	}

	function paint(c: string, dark: boolean): { fill: string; alpha: number } {
		const alpha = groundAware ? (dark ? 1 : 0.35) : 1;
		if (c.startsWith('rgb') || c === '#38B6FF' || c === '#FF7870') return { fill: c, alpha };
		if (!groundAware) return { fill: c, alpha };
		return { fill: dark ? CREAM : CHARCOAL, alpha };
	}

	function frame() {
		if (!running) return;
		time += 0.016;

		wander += (wanderTarget - wander) * RAMP;
		if (spinEnabled) {
			rotSpeed += (rotSpeedTarget - rotSpeed) * RAMP;
			rotation += rotSpeed;
		} else {
			rotSpeed += (0 - rotSpeed) * RAMP;
			rotation += (0 - rotation) * RAMP;
		}

		const spreadTarget = scrollSpread && opts.getSpreadTarget ? opts.getSpreadTarget() : 0;
		spread += (spreadTarget - spread) * RAMP;
		const maxSpreadPx = Math.min(W, H) * MAX_SPREAD_DIST;

		ctx.clearRect(0, 0, W, H);

		const cvr = cv.getBoundingClientRect();
		const mx = mouse.x - cvr.left;
		const my = mouse.y - cvr.top;
		const charcoalBottom = document.documentElement.classList.contains('is-home')
			? window.innerHeight - window.scrollY
			: -1e9;
		const ft = footerEl?.getBoundingClientRect();

		const cosR = Math.cos(rotation);
		const sinR = Math.sin(rotation);

		for (let i = 0; i < particles.length; i++) {
			const p = particles[i];
			const vy = cvr.top + p.y;
			const dark = vy < charcoalBottom || (!!ft && vy >= ft.top && vy <= ft.bottom);
			const ink = paint(p.c, dark);

			if (scatter) {
				p.rot = (p.rot ?? 0) + (p.rotV ?? 0);
				p.x += p.vx + Math.sin(time * 0.35 + p.phase) * 0.2;
				p.y += p.vy + Math.cos(time * 0.28 + p.phase) * 0.2;
				if (p.x < -40) p.x = W + 40;
				if (p.x > W + 40) p.x = -40;
				if (p.y < -40) p.y = H + 40;
				if (p.y > H + 40) p.y = -40;
				const mdx = p.x - mx;
				const mdy = p.y - my;
				const md2 = mdx * mdx + mdy * mdy;
				const R = 100;
				if (md2 < R * R) {
					const dd = Math.sqrt(md2) || 1;
					const f = ((R - dd) / R) * 1.2;
					p.x += (mdx / dd) * f;
					p.y += (mdy / dd) * f;
				}
				drawShape(p, ink.fill, ink.alpha);
				continue;
			}

			const dx = p.tx - formCx;
			const dy = p.ty - formCy;
			const rx = dx * cosR - dy * sinR + formCx;
			const ry = dx * sinR + dy * cosR + formCy;
			const sx = rx + ((rx - formCx) * spread * maxSpreadPx) / Math.max(1, Math.min(W, H) * 0.4);
			const sy = ry + ((ry - formCy) * spread * maxSpreadPx) / Math.max(1, Math.min(W, H) * 0.4);
			const wx = sx + Math.sin(time * 0.8 + p.phase) * wander;
			const wy = sy + Math.cos(time * 0.6 + p.phase * 1.3) * wander;

			let ax = (wx - p.x) * 0.02;
			let ay = (wy - p.y) * 0.02;

			const mdx = p.x - mx;
			const mdy = p.y - my;
			const md2 = mdx * mdx + mdy * mdy;
			const R = 100;
			if (md2 < R * R) {
				const dd = Math.sqrt(md2) || 1;
				const f = ((R - dd) / R) * 3.4;
				ax += (mdx / dd) * f;
				ay += (mdy / dd) * f;
			}

			p.vx = (p.vx + ax) * 0.86;
			p.vy = (p.vy + ay) * 0.86;
			p.x += p.vx;
			p.y += p.vy;

			ctx.globalAlpha = ink.alpha;
			ctx.fillStyle = ink.fill;
			ctx.fillRect(p.x, p.y, p.s, p.s);
		}
		ctx.globalAlpha = 1;

		if (bctx) {
			bctx.clearRect(0, 0, W, H);
			for (let i = bursts.length - 1; i >= 0; i--) {
				const b = bursts[i];
				b.x += b.vx;
				b.y += b.vy;
				if (b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) {
					bursts.splice(i, 1);
					continue;
				}
				const vy = cvr.top + b.y;
				const dark = vy < charcoalBottom || (!!ft && vy >= ft.top && vy <= ft.bottom);
				const ink = paint(b.c, dark);
				bctx.globalAlpha = ink.alpha;
				bctx.fillStyle = ink.fill;
				bctx.fillRect(b.x, b.y, b.s, b.s);
			}
			bctx.globalAlpha = 1;
		}

		raf = requestAnimationFrame(frame);
	}

	function drawStill() {
		ctx.clearRect(0, 0, W, H);
		for (let i = 0; i < particles.length; i++) {
			const p = particles[i];
			ctx.globalAlpha = 1;
			ctx.fillStyle = p.c;
			ctx.fillRect(p.tx, p.ty, p.s, p.s);
		}
		ctx.globalAlpha = 1;
	}

	function start() {
		if (running) return;
		running = true;
		raf = requestAnimationFrame(frame);
	}

	function stop() {
		running = false;
		cancelAnimationFrame(raf);
	}

	function setSpin(on: boolean) {
		spinEnabled = on;
		rotSpeedTarget = on ? BASE_ROT : 0;
	}

	function excite() {
		if (spinEnabled) rotSpeedTarget = FAST_ROT;
		wanderTarget = FAST_WANDER;
		if (moveTimer) clearTimeout(moveTimer);
		moveTimer = setTimeout(() => {
			rotSpeedTarget = spinEnabled ? BASE_ROT : 0;
			wanderTarget = BASE_WANDER;
		}, 600);
	}

	function setMouse(clientX: number, clientY: number) {
		mouse.x = clientX;
		mouse.y = clientY;
		excite();
	}

	function clearMouse() {
		mouse.x = -9999;
		mouse.y = -9999;
	}

	function spawnBurst(clientX: number, clientY: number) {
		if (!burstCv) return;
		const cvr = burstCv.getBoundingClientRect();
		const x = clientX - cvr.left;
		const y = clientY - cvr.top;
		const count = W < 768 ? 48 : 72;
		for (let i = 0; i < count; i++) {
			const ang = Math.random() * Math.PI * 2;
			const spd = 8 + Math.random() * 18;
			const r = Math.random();
			bursts.push({
				x,
				y,
				vx: Math.cos(ang) * spd,
				vy: Math.sin(ang) * spd,
				s: 2 + Math.random() * 3.5,
				c: r < 0.08 ? '#38B6FF' : r < 0.28 ? '#FF7870' : '#F2EFEB',
			});
		}
		if (bursts.length > 420) bursts.splice(0, bursts.length - 420);
	}

	const onPointerMove = (e: PointerEvent) => setMouse(e.clientX, e.clientY);
	const onPointerLeave = () => clearMouse();
	const onTouchEnd = () => clearMouse();
	const onClick = (e: MouseEvent) => spawnBurst(e.clientX, e.clientY);
	const onTouchMove = (e: TouchEvent) => {
		if (!e.touches.length) return;
		e.preventDefault();
		const t = e.touches[0];
		setMouse(t.clientX, t.clientY);
	};
	const onTouchStart = (e: TouchEvent) => {
		if (!e.touches.length) return;
		const t = e.touches[0];
		setMouse(t.clientX, t.clientY);
	};

	const pointerRoot = opts.pointerRoot;
	if (pointerRoot) {
		pointerRoot.addEventListener('pointermove', onPointerMove);
		pointerRoot.addEventListener('pointerleave', onPointerLeave);
		pointerRoot.addEventListener('touchend', onTouchEnd);
	}
	if (opts.touchDrag) {
		cv.addEventListener('touchstart', onTouchStart, { passive: true });
		cv.addEventListener('touchmove', onTouchMove, { passive: false });
		cv.addEventListener('touchend', onTouchEnd);
	}
	if (opts.clickBurst) {
		cv.addEventListener('click', onClick);
	}

	function destroy() {
		stop();
		if (pointerRoot) {
			pointerRoot.removeEventListener('pointermove', onPointerMove);
			pointerRoot.removeEventListener('pointerleave', onPointerLeave);
			pointerRoot.removeEventListener('touchend', onTouchEnd);
		}
		cv.removeEventListener('touchstart', onTouchStart);
		cv.removeEventListener('touchmove', onTouchMove);
		cv.removeEventListener('touchend', onTouchEnd);
		cv.removeEventListener('click', onClick);
		if (moveTimer) clearTimeout(moveTimer);
	}

	return {
		sampleImage,
		seedScatter,
		drawStill,
		resize,
		start,
		stop,
		setSpin,
		setMouse,
		clearMouse,
		spawnBurst,
		destroy,
		get mode() {
			return currentMode;
		},
		get source() {
			return currentSource;
		},
	};
}
