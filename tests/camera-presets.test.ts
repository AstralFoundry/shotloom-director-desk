import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_PRESETS, cameraPresetPath } from '../src/core/cinematography/camera-presets.ts';

test('every camera preset generates a finite, ordered four-second path', () => {
    for (const preset of CAMERA_PRESETS) {
        const { path } = cameraPresetPath(preset.id, [3, 2, 1], [0, 1, 0], 2, 4, 40);
        assert.equal(path.points[0].time, 2, preset.id);
        assert.equal(path.points.at(-1)?.time, 6, preset.id);
        assert.ok(path.points.length >= 3, preset.id);
        for (let i = 0; i < path.points.length; i++) {
            assert.ok(path.points[i].position.every(Number.isFinite), preset.id);
            if (i > 0) assert.ok(path.points[i].time > path.points[i - 1].time, preset.id);
        }
    }
});

test('orbit closes and dolly zoom adjusts focal length with distance', () => {
    const orbit = cameraPresetPath('orbit', [3, 2, 1], [0, 1, 0], 0, 4, 40).path;
    orbit.points[0].position.forEach((value, axis) =>
        assert.ok(Math.abs(value - orbit.points.at(-1)!.position[axis]) < 1e-8),
    );
    const zoom = cameraPresetPath('dolly-zoom', [3, 2, 1], [0, 1, 0], 0, 4, 40);
    assert.deepEqual(
        zoom.focalKeys?.map((key) => key.value),
        [40, 22],
    );
});
