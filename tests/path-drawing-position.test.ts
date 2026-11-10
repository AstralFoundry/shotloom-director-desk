import test from 'node:test';
import assert from 'node:assert/strict';
import { entity, type Vec3 } from '../src/core/model.ts';
import { pathDrawingPosition } from '../src/core/editor/path-drawing-position.ts';

test('camera drawing preserves floor-relative height for ground and elevated surfaces', () => {
    const camera = entity('camera', 'camera', 'camera', [0, 4.7, 0]);
    camera.path = { smooth: false, points: [{ time: 0, position: [0, 4.7, 0] }] };
    for (const [floor, base] of [
        [3, 4.7],
        [-3, -1.3],
        [0, 1.7],
    ]) {
        camera.path.points[0].position[1] = base;
        const hit: Vec3 = [2, floor, 1];
        assert.ok(Math.abs(pathDrawingPosition(hit, camera, floor)[1] - base) < 1e-10);
        assert.ok(Math.abs(pathDrawingPosition([2, floor + 0.6, 1], camera, floor)[1] - (base + 0.6)) < 1e-10);
        assert.deepEqual(hit, [2, floor, 1]);
    }
    const actor = entity('actor', 'human-adult', 'actor', [0, 4.7, 0]);
    assert.deepEqual(pathDrawingPosition([2, 3.6, 1], actor, 3), [2, 3.6, 1]);
});
