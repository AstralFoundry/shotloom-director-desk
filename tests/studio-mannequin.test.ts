import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { clip, entity } from '../src/core/model.ts';
import { makeHuman, colorHuman } from '../src/core/assets/humanoid.ts';
import { makeCrowd } from '../src/core/assets/crowd.ts';
import { animateHuman } from '../src/core/assets/human-animation.ts';
import { disposeTree } from '../src/core/assets/dispose.ts';

function visibleBounds(root: T.Object3D) {
    root.updateMatrixWorld(true);
    const bounds = new T.Box3();
    root.traverse((node) => {
        if (node instanceof T.Mesh && node.visible && node.userData.studioVisual) bounds.expandByObject(node, true);
    });
    return bounds;
}

test('original mannequin stays grounded and follows wave, sit, walk, run and jump poses', () => {
    const actor = entity('actor', 'human-adult', 'Test');
    const rig = makeHuman(actor);
    try {
        assert.equal(rig.root.userData.studioMannequin, true);
        assert.ok(rig.root.getObjectByName('StudioHead') instanceof T.Mesh);
        const poses = new Map<string, T.Box3>();
        for (const action of ['idle', 'wave', 'sit', 'walk', 'run', 'jump'] as const) {
            actor.clips = [clip(action, 0, 4)];
            animateHuman(rig, actor, 1);
            const bounds = visibleBounds(rig.root);
            assert.ok([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite), action);
            assert.ok(bounds.min.y > -0.08 && bounds.min.y < 0.1, `${action} feet`);
            poses.set(action, bounds);
            if (action === 'wave') {
                const left = rig.root.getObjectByName('StudioleftHand')!.getWorldPosition(new T.Vector3());
                const right = rig.root.getObjectByName('StudiorightHand')!.getWorldPosition(new T.Vector3());
                assert.ok(Math.abs(left.y - right.y) > 0.45, 'wave raises a hand');
            }
        }
        assert.ok(poses.get('sit')!.max.y < poses.get('idle')!.max.y - 0.25);
        const original = rig.skin.color.clone();
        colorHuman(rig, '#c86f6f');
        assert.ok(!rig.skin.color.equals(original), 'the color control still changes the mannequin');
    } finally {
        disposeTree(rig.root);
    }
});

test('adult, female, child and crowd variants use the original geometry', () => {
    for (const asset of ['person', 'woman', 'human-adult', 'human-female', 'human-child']) {
        const actor = entity('actor', asset, asset);
        const rig = makeHuman(actor);
        try {
            assert.equal(rig.root.userData.studioMannequin, true, asset);
            const bounds = visibleBounds(rig.root);
            assert.ok(Math.abs(bounds.max.y - actor.height) < 0.08, asset);
        } finally {
            disposeTree(rig.root);
        }
    }
    const group = entity('crowd', 'crowd', 'Group');
    group.count = 3;
    const crowd = makeCrowd(group);
    try {
        assert.equal(crowd.rigs.length, 3);
        for (const rig of crowd.rigs) {
            assert.equal(rig.root.userData.studioMannequin, true);
            assert.ok(rig.root.getObjectByName('StudioTorso') instanceof T.Mesh);
        }
    } finally {
        disposeTree(crowd.root);
    }
});
