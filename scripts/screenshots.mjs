import { setupDemoScene } from './demo-scene.mjs';
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(process.env.DIRECTOR_URL || 'http://127.0.0.1:5173');
    await page.waitForFunction(() => !!window.__editorDebug?.session.engineOrNull);
    await setupDemoScene(page);
    await fs.mkdir('docs/images', { recursive: true });
    const capture = async (name) => {
        await page.mouse.move(0, 0);
        await page.waitForTimeout(1400);
        await page.screenshot({ path: `docs/images/${name}.png` });
    };
    await page.evaluate(() => window.__editorDebug.session.setTheme('light'));
    await page.getByRole('button', { name: '场景', exact: true }).click();
    await page.evaluate(() => {
        const { session, store } = window.__editorDebug;
        session.selectEntity(store.getState().project.entities.find((e) => e.kind === 'actor').id);
        session.setInspectorTab('actions');
    });
    await capture('shotloom-editor');
    await page.getByRole('button', { name: '运镜', exact: true }).click();
    await page.evaluate(() => {
        const { session, store } = window.__editorDebug;
        session.selectEntity(store.getState().project.entities.find((e) => e.kind === 'camera').id);
        session.setInspectorTab('camera');
    });
    await capture('shotloom-camera-moves');
    await page.evaluate(() => window.__editorDebug.session.setTheme('dark'));
    await capture('shotloom-editor-dark');
    if (errors.length) throw Error(errors.join('\n'));
    console.log('Captured light workspace, camera moves and dark workspace.');
} finally {
    await browser.close();
}
