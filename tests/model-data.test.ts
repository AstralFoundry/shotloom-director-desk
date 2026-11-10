import test from 'node:test';
import assert from 'node:assert/strict';
import { clone, demoProject } from '../src/core/model.ts';
import { packModelFiles } from '../src/core/resources/model-package.ts';
import { modelResourceId } from '../src/core/resources/project-resources.ts';
import { sameModelResources, sameProjectData } from '../src/core/resources/package-validation.ts';
import { SceneSession } from '../src/core/scenes/sequence-session.ts';

async function fixture() {
    const p = demoProject();
    p.version = 2;
    const source = packModelFiles('shape.obj', [
        { path: 'shape.obj', bytes: new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n') },
    ]);
    p.resources = [
        { id: await modelResourceId(source), name: 'shape', package: source, copyright: '', license: '', source: '' },
    ];
    return p;
}
test('source records and unknown metadata remain independent across every clone entry point', async () => {
    const p = await fixture(),
        resource = p.resources![0];
    Object.assign(resource.package, { future: { nested: ['original'] } });
    for (const copy of [clone(p).resources![0], clone(p.resources!)[0], clone(resource)]) {
        assert.deepEqual(copy, resource);
        assert.notEqual(copy.package.files, resource.package.files);
        copy.name = 'edited';
        copy.package.files[0].data = 'changed';
        (copy.package as typeof copy.package & { future: { nested: string[] } }).future.nested[0] = 'edited';
        assert.equal(resource.name, 'shape');
        assert.notEqual(resource.package.files[0].data, 'changed');
        assert.equal(
            (resource.package as typeof copy.package & { future: { nested: string[] } }).future.nested[0],
            'original',
        );
    }
});
test('resource metadata, contents, order and deletion are not lost by fast comparison', async () => {
    const p = await fixture(),
        q = clone(p);
    assert.ok(sameProjectData(p, q));
    q.resources![0].license = 'MIT';
    assert.equal(sameModelResources(p.resources!, q.resources!), false);
    assert.equal(sameProjectData(p, q), false);
    q.resources![0].license = '';
    q.resources![0].package.files[0].data = 'changed';
    assert.equal(sameProjectData(p, q), false);
    assert.equal(sameProjectData(p, { ...p, resources: [] }), false);
    assert.equal(sameProjectData(p, { ...p, duration: p.duration + 1 }), false);
});
test('position and resource metadata undo/redo remain isolated; changed same-ID source is rejected', async () => {
    const p = await fixture(),
        session = new SceneSession(p),
        original = session.project();
    let transaction = session.begin(),
        next = clone(transaction.project);
    next.entities[0].position[0] += 2;
    session.commit(transaction, next);
    assert.equal(session.undoCount, 1);
    session.undo();
    assert.deepEqual(session.project(), original);
    session.redo();
    assert.equal(session.project().entities[0].position[0], next.entities[0].position[0]);
    transaction = session.begin();
    next = clone(transaction.project);
    next.resources![0].license = 'MIT';
    session.commit(transaction, next);
    session.undo();
    assert.equal(session.project().resources![0].license, '');
    session.redo();
    assert.equal(session.project().resources![0].license, 'MIT');
    transaction = session.begin();
    next = clone(transaction.project);
    next.resources![0].package = packModelFiles('shape.obj', [
        { path: 'shape.obj', bytes: new TextEncoder().encode('v 0 0 0\nv 2 0 0\nv 0 1 0\nf 1 2 3\n') },
    ]);
    assert.throws(() => session.commit(transaction, next), /不可原地改写/);
    session.rollback(transaction);
    assert.equal(session.project().resources![0].package.files[0].data, p.resources![0].package.files[0].data);
});
