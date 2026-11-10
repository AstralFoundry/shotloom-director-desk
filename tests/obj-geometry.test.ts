import test from 'node:test';
import assert from 'node:assert/strict';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { packModelFiles } from '../src/core/resources/model-package.ts';
import { parseObjGeometry } from '../src/core/resources/obj-geometry.ts';
import { normalizedObjText, objReferences, sourceLines } from '../src/core/resources/obj-source.ts';
import { loadObjModel } from '../src/core/resources/obj-model.ts';

const bytes = (s: string) => new TextEncoder().encode(s);
const triangle = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
const pack = (text: string) => packModelFiles('s.obj', [{ path: 's.obj', bytes: bytes(text) }]);

test('OBJ loading normalizes a legal relative entry and retains material dependencies', async () => {
    const pkg = packModelFiles('dir/s.obj', [
        { path: 'dir/s.obj', bytes: bytes('mtllib m.mtl\nusemtl red\n' + triangle) },
        { path: 'dir/m.mtl', bytes: bytes('newmtl red\nKd 1 0 0') },
    ]);
    for (const entry of ['dir/s.obj', './dir/s.obj', 'dir/./s.obj']) {
        const source = { ...pkg, entry },
            parsed = parseObjGeometry(source);
        assert.equal(parsed.meshes.length, 1);
        assert.equal(parsed.files.has('dir/s.obj'), false);
        assert.match(parsed.materialText, /newmtl red/);
        const loaded = await loadObjModel(source);
        try {
            assert.equal(loaded.inspection.triangles, 1);
        } finally {
            loaded.dispose();
        }
    }
    assert.throws(() => parseObjGeometry({ ...pkg, entry: 'dir/missing.obj' }), /未找到模型主文件/);
});

test('streamed OBJ dependency scan preserves quoted comments, continued lines and uppercase keywords', () => {
    const source = bytes(' MTLLIB "a#b.mtl" \\\r\n c.mtl # comment\r\n' + triangle + 'USEMTL red # end');
    assert.deepEqual(objReferences(source), [
        { key: 'mtllib', value: '"a#b.mtl"  c.mtl' },
        { key: 'usemtl', value: 'red' },
    ]);
    assert.deepEqual([...sourceLines(bytes(normalizedObjText(source)))], [...sourceLines(source)]);
    assert.throws(() => objReferences(new Uint8Array([255])), /UTF-8/);
});

test('worker geometry representation preserves negative indices, UVs, normals, vertex colors and material groups', () => {
    const text =
        'mtllib m.mtl\no colored\nv 0 0 0 1 0 0\nv 1 0 0 0 1 0\nv 0 1 0 0 0 1\nvt 0 0\nvt 1 0\nvt 0 1\nvn 0 0 1\nusemtl red\nf -3/1/1 -2/2/1 -1/3/1\nusemtl blue\ns off\nf 1/1/1 3/3/1 2/2/1';
    const pkg = packModelFiles('s.obj', [
        { path: 's.obj', bytes: bytes(text) },
        { path: 'm.mtl', bytes: bytes('newmtl red\nKd 1 0 0\nnewmtl blue\nKd 0 0 1') },
    ]);
    const result = parseObjGeometry(pkg),
        reference = new OBJLoader().parse(text).children[0] as import('three').Mesh;
    assert.equal(result.meshes.length, 1);
    const mesh = result.meshes[0];
    assert.equal(mesh.name, 'colored');
    assert.equal(mesh.multiple, true);
    assert.deepEqual(mesh.groups, reference.geometry.groups);
    for (const a of mesh.attributes) assert.deepEqual(a.array, reference.geometry.getAttribute(a.name).array);
    assert.deepEqual(
        mesh.materials.map((m) => m.name),
        ['red', 'blue'],
    );
    assert.equal(result.files.has('s.obj'), false);
    assert.match(result.materialText, /Kd|kd/);
    reference.geometry.dispose();
    for (const m of reference.material as import('three').Material[]) m.dispose();
});

test('OBJ loader rebuilds inspectable geometry and rejects unsupported primitives and missing materials', async () => {
    const loaded = await loadObjModel(pack(triangle));
    try {
        assert.equal(loaded.inspection.meshes, 1);
        assert.equal(loaded.inspection.triangles, 1);
    } finally {
        loaded.dispose();
    }
    assert.throws(() => parseObjGeometry(pack('v 0 0 0\nv 1 0 0\nl 1 2')), /面网格/);
    assert.throws(() => pack('usemtl missing\n' + triangle), /未定义/);
});
