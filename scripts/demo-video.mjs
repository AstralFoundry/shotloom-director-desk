import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { setupDemoScene } from './demo-scene.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(process.env.DIRECTOR_URL || 'http://127.0.0.1:5173');
    await page.waitForFunction(() => !!window.__editorDebug?.session.engineOrNull);
    await setupDemoScene(page);
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    downloadPromise.catch(() => {});
    await page.evaluate(async () => {
        const { entity, clip } = await import('/src/core/model.ts');
        const { cameraPresetPath } = await import('/src/core/cinematography/camera-presets.ts');
        const { readSceneDocument } = await import('/src/core/scenes/sequence-project.ts');
        const { exportVideo } = await import('/src/core/export.ts');
        const { session, store } = window.__editorDebug;
        const project = structuredClone(store.getState().project);
        project.entities = project.entities.filter((e) => e.kind !== 'prop' || e.asset === 'ground');
        const actors = project.entities.filter((e) => e.kind === 'actor');
        actors.forEach((actor, i) => {
            const sign = i ? 1 : -1;
            actor.position = [sign * 2, 0, 0];
            actor.rotation[1] = (-sign * Math.PI) / 2;
            actor.clips = [clip('walk', 0, 3), clip('wave', 3, 6), clip('jump', 6, 8), clip('wave', 8, 12)];
            actor.path = {
                smooth: false,
                points: [
                    { time: 0, position: [sign * 2, 0, 0] },
                    { time: 3, position: [sign * 0.8, 0, 0] },
                ],
            };
        });
        const wide = project.entities.find((e) => e.kind === 'camera');
        wide.position = [0, 2.4, 8];
        wide.path = null;
        wide.camera.targetPath = undefined;
        wide.camera.target = [0, 0.85, 0];
        wide.camera.focal = 36;
        const close = entity('camera', 'camera', '双人近景', [1.8, 1.7, 5.2]);
        close.camera.target = [0, 1.05, 0];
        close.camera.focal = 42;
        const orbit = entity('camera', 'camera', '环绕', [0, 2.3, 7]);
        orbit.camera.target = [0, 0.95, 0];
        orbit.camera.focal = 36;
        const motion = cameraPresetPath('orbit', orbit.position, orbit.camera.target, 6, 6, 36);
        orbit.path = motion.path;
        orbit.camera.targetPath = motion.targetPath;
        project.entities.push(close, orbit);
        project.cuts = [
            { time: 0, cameraId: wide.id },
            { time: 3, cameraId: close.id },
            { time: 6, cameraId: orbit.id },
        ];
        session.replaceSceneDocument(readSceneDocument(project), 'Demo video');
        session.setTheme('light');
        const blob = await exportVideo(
            session.engineOrNull,
            {
                start: 0,
                end: 12,
                fps: 24,
                width: 1280,
                height: 720,
                cameraId: 'program',
                format: 'mp4',
                monochrome: false,
            },
            new AbortController().signal,
            () => {},
        );
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'demo-raw.mp4';
        link.click();
    });
    await fs.mkdir('tmp/demo', { recursive: true });
    await (await downloadPromise).saveAs('tmp/demo/raw.mp4');
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const [index, caption] of [
        'A tiny scene. A little awkward.',
        'Say hello.',
        'That went well.',
        'Block it. Move it. Shoot it.',
    ].entries()) {
        await page.setContent(`<style>
            body { margin: 0; color: #252b32; font-family: Arial, sans-serif; font-weight: 700; }
            header { position: absolute; top: 38px; width: 100%; text-align: center; font-size: 20px; letter-spacing: 2px; }
            footer { position: absolute; top: 630px; width: 100%; text-align: center; font-size: 32px; }
            </style><header>SHOTLOOM / DIRECTOR DESK</header><footer>${caption}</footer>`);
        await page.screenshot({ path: `tmp/demo/caption-${index}.png`, omitBackground: true });
    }
} finally {
    await browser.close();
}

await fs.mkdir('docs/images', { recursive: true });
const overlays = [
    "[0:v][1:v]overlay=enable='lt(t,3)'[a]",
    "[a][2:v]overlay=enable='between(t,3,6)'[b]",
    "[b][3:v]overlay=enable='between(t,6,9)'[c]",
    "[c][4:v]overlay=enable='gte(t,9)',fade=t=in:st=0:d=0.25,fade=t=out:st=11.6:d=0.4[out]",
].join(';');
function ffmpeg(args) {
    const result = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
    if (result.status !== 0) throw Error('ffmpeg failed');
}
ffmpeg([
    '-i',
    'tmp/demo/raw.mp4',
    ...[0, 1, 2, 3].flatMap((i) => ['-loop', '1', '-i', `tmp/demo/caption-${i}.png`]),
    '-filter_complex',
    overlays,
    '-map',
    '[out]',
    '-t',
    '12',
    '-c:v',
    'libx264',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    'docs/images/shotloom-demo.mp4',
]);
ffmpeg([
    '-i',
    'docs/images/shotloom-demo.mp4',
    '-filter_complex',
    'fps=10,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer',
    '-loop',
    '0',
    'docs/images/shotloom-demo.gif',
]);
ffmpeg(['-ss', '4', '-i', 'docs/images/shotloom-demo.mp4', '-frames:v', '1', 'tmp/demo/poster.png']);
console.log('Created 12-second MP4 and animated README preview.');
