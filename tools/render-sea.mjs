// Render laut jadi video loop mulus, memakai shader yang sama persis dengan app.js.
// Pakai:  node tools/render-sea.mjs [light|dark] [lebar] [fps] [detik]
//   argumen ke-5 (opsional): CRF, default 28.   contoh: node tools/render-sea.mjs light 1280 30 20 28   ->  video/sea-light.mp4  (area dunia 480 x 640 satuan, kapal di tengah)
// Butuh: Node 18+, ffmpeg di PATH, dan  npm i playwright  (lalu  npx playwright install chromium  sekali saja).
// Env: HEADFUL=1 untuk membuka jendela browser (kadang lebih cepat karena pakai GPU asli).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const theme = args[0] === 'dark' ? 'dark' : 'light', AREA = 480;     // lebar area dunia (satuan); tinggi = 4/3 lebar
const W = Math.round((+args[1] || 1280) / 4) * 4, H = W / 3 * 4;
const FPS = +args[2] || 30, SECS = +args[3] || 20, XF = 2, CRF = +args[4] || 28;   // CRF: makin besar makin kecil file (23 = tajam, 28 = ringan, 32 = sangat kecil)     // XF = detik crossfade supaya sambungan loop tidak loncat
const total = (SECS + XF) * FPS;

const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const fsSrc = src.match(/const FS = `([\s\S]*?)`\.replace\('HULLFN', HULLFN\);/)[1];
const hull = src.match(/const HULLFN = `([\s\S]*?)`;/)[1];
const FS = fsSrc.replace('HULLFN', hull)
  .replace('for (int i = 0; i < 3; i++) { s += a * vnoise(p);', 'for (int i = 0; i < 2; i++) { s += a * vnoise(p);').replace('return s * 1.07;', 'return s * 1.25;');   // sama dengan app.js

const html = `<canvas id=c width=${W} height=${H}></canvas><script>
const gl=document.getElementById('c').getContext('webgl',{preserveDrawingBuffer:true,antialias:false});
const mk=(t,s)=>{const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(o));return o};
const pr=gl.createProgram();gl.attachShader(pr,mk(gl.VERTEX_SHADER,'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'));gl.attachShader(pr,mk(gl.FRAGMENT_SHADER,${JSON.stringify(FS)}));gl.linkProgram(pr);gl.useProgram(pr);
gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
const l=gl.getAttribLocation(pr,'a');gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0);
const N=256,px=new Uint8Array(N*N*4);let sd=1337;for(let i=0;i<px.length;i++){sd=(sd*1664525+1013904223)>>>0;px[i]=sd>>>24}
const tx=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tx);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,N,N,0,gl.RGBA,gl.UNSIGNED_BYTE,px);
for(const[k,v]of[[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.REPEAT],[gl.TEXTURE_WRAP_T,gl.REPEAT]])gl.texParameteri(gl.TEXTURE_2D,k,v);
const u=n=>gl.getUniformLocation(pr,n);gl.uniform1i(u('uN'),0);gl.viewport(0,0,${W},${H});
gl.uniform2f(u('uRes'),${W},${H});gl.uniform2f(u('uCam'),0,0);gl.uniform1f(u('uZoom'),1);gl.uniform1f(u('uU'),${W}/${AREA});gl.uniform1f(u('uDark'),${theme === 'dark' ? 1 : 0});gl.uniform1f(u('uScale'),1);
window.frame=t=>{gl.uniform1f(u('uTime'),t);gl.drawArrays(gl.TRIANGLES,0,3);return document.getElementById('c').toDataURL('image/jpeg',0.97).slice(23)};
</script>`;

fs.mkdirSync(path.join(root, 'video'), { recursive: true });
const out = path.join(root, 'video', `sea-${theme}.mp4`), tmp = path.join(root, 'video', `.raw-${theme}.mp4`);
// 1) semua frame (SECS + XF detik) -> file sementara
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((res, rej) => { ff.on('close', c => c ? rej(new Error('ffmpeg gagal (' + c + ')')) : res()); ff.on('error', rej); });
const browser = await chromium.launch({ headless: !process.env.HEADFUL, args: ['--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
await page.setContent(html);
for (let i = 0; i < total; i++) {
  const b64 = await page.evaluate(t => window.frame(t), i / FPS);
  if (!ff.stdin.write(Buffer.from(b64, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
  if (i % FPS === 0) process.stdout.write(`\rframe ${i}/${total}`);
}
ff.stdin.end(); await done; await browser.close();
// 2) sambungan loop: SECS detik terakhir akhir (A[SECS..SECS+XF]) di-crossfade ke awal (A[0..XF]), hasilnya tepat SECS detik dan menyambung mulus
const f = `[0:v]split=3[a][b][c];[a]trim=start=${XF}:end=${SECS},setpts=PTS-STARTPTS[mid];[b]trim=start=${SECS}:end=${SECS + XF},setpts=PTS-STARTPTS[tail];[c]trim=start=0:end=${XF},setpts=PTS-STARTPTS[head];` +
  `[tail][head]xfade=transition=fade:duration=${XF}:offset=0[x];[x][mid]concat=n=2:v=1:a=0[v]`;
await new Promise((res, rej) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-filter_complex', f, '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(CRF),
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out], { stdio: 'inherit' }).on('close', c => c ? rej(new Error('ffmpeg gagal')) : res()));
fs.unlinkSync(tmp);
console.log(`\nSelesai: ${out}  (${W}x${H}, ${FPS} fps, ${SECS} dtk)`);
