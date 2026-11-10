const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('test assets bootstrap checks pinned downloads, extracts furniture and reuses offline cache', async () => {
    const { sources, prepareTestAssets, checkTestAssets } = await import('../scripts/test-assets.mjs');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'director-fixtures-'));
    try {
        await assert.rejects(checkTestAssets(root), /npm run test:assets/);
        let calls = 0;
        const fetcher = async (url) => {
            calls++;
            const source = sources.find((s) => s.url === url);
            assert.ok(source, 'only pinned URLs may be requested');
            const bytes = await fs.readFile(path.resolve(__dirname, '../test-assets/external', source.file));
            return { ok: true, arrayBuffer: async () => bytes };
        };
        await prepareTestAssets(root, fetcher);
        assert.equal(calls, sources.length);
        await checkTestAssets(root);
        const offline = async () => {
            throw Error('offline');
        };
        await prepareTestAssets(root, offline);
        await fs.writeFile(path.join(root, sources[0].file), 'corrupt');
        await assert.rejects(
            prepareTestAssets(root, async () => ({ ok: true, arrayBuffer: async () => Buffer.from('wrong') })),
            /校验失败/,
        );
        calls = 0;
        await prepareTestAssets(root, fetcher);
        assert.equal(calls, 1);
    } finally {
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'director-fixtures-'));
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('fixture extraction permits only fixed archive members and rejects incomplete archives', async () => {
    const { extractFurniture, furnitureFiles } = await import('../scripts/test-assets.mjs');
    const { zipSync } = await import('three/addons/libs/fflate.module.js');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'director-fixtures-'));
    try {
        const files = Object.fromEntries(furnitureFiles.map((file) => [file, Buffer.from('fixture')]));
        files['../escape.txt'] = Buffer.from('bad');
        files['unneeded.txt'] = Buffer.from('unused');
        await extractFurniture(zipSync(files), root);
        await assert.rejects(fs.access(path.join(root, 'escape.txt')));
        await assert.rejects(fs.access(path.join(root, 'kenney-furniture/unneeded.txt')));
        await fs.access(path.join(root, 'kenney-furniture/License.txt'));
        delete files[furnitureFiles[0]];
        await assert.rejects(extractFurniture(zipSync(files), path.join(root, 'incomplete')), /缺少文件/);
        await assert.rejects(fs.access(path.join(root, 'incomplete')));
    } finally {
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'director-fixtures-'));
        await fs.rm(root, { recursive: true, force: true });
    }
});
