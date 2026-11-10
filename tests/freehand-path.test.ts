import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simplifyFreehand, timeFreehand } from '../src/core/editor/freehand-path.ts';
import type { Vec3 } from '../src/core/model.ts';

test('freehand removes drawing noise without changing endpoints or source', () => {
    const points: Vec3[] = Array.from({ length: 101 }, (_, i) => [
        i / 10,
        0,
        i === 0 || i === 100 ? 0 : Math.sin(i) * 0.005,
    ]);
    const original = structuredClone(points),
        result = simplifyFreehand(points);
    assert.deepEqual(result, [
        [0, 0, 0],
        [10, 0, 0],
    ]);
    assert.deepEqual(points, original);
    result[0][0] = 9;
    assert.equal(points[0][0], 0);
});
test('freehand preserves stair heights, corners and closed loops', () => {
    const stairs: Vec3[] = [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0.3, 0],
        [2, 0.3, 0],
        [2, 0.6, 0],
        [3, 0.6, 0],
    ];
    assert.deepEqual(simplifyFreehand(stairs), stairs);
    const loop: Vec3[] = [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1],
        [0, 0, 0],
    ];
    assert.deepEqual(simplifyFreehand(loop), loop);
});
test('freehand times by distance, independent of pointer density; exact duration', () => {
    const sparse: Vec3[] = [
        [0, 0, 0],
        [3, 0, 0],
        [3, 0, 4],
    ];
    const dense: Vec3[] = [
        [0, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
        [3, 0, 1],
        [3, 0, 2],
        [3, 0, 4],
    ];
    assert.deepEqual(timeFreehand(sparse, 2, 7), timeFreehand(dense, 2, 7));
    assert.deepEqual(
        timeFreehand(dense, 2, 7).map((p) => p.time),
        [2, 5, 9],
    );
    const loop = timeFreehand([...sparse, [0, 0, 0]], 0.5, 3);
    assert.equal(loop.at(-1)!.time, 3.5);
    assert.ok(loop.every((p, i) => i === 0 || p.time > loop[i - 1].time));
});
test('freehand rejects invalid input, handles clicks and duplicates', () => {
    assert.deepEqual(
        timeFreehand(
            [
                [1, 2, 3],
                [1, 2, 3],
            ],
            0,
            5,
        ),
        [{ time: 0, position: [1, 2, 3] }],
    );
    assert.deepEqual(simplifyFreehand([]), []);
    assert.throws(() => simplifyFreehand([[NaN, 0, 0]]));
    assert.throws(() => simplifyFreehand([], 0));
    assert.throws(() => timeFreehand([], 0, 0));
    assert.throws(() => timeFreehand([], -1, 5));
});
