import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../src/core/model.ts';
import {
    checkCrowding,
    checkOverlaps,
    groupIssues,
    isInFrame,
    spatialReportJson,
    spatialReportText,
    toSpatialBox,
    type SpatialBox,
} from '../src/core/spatial/checks.ts';

/**
 * Spatial checks decide what the "space check" panel reports, so the thresholds and the
 * grouping behaviour are pinned here: a silent change would make the panel either noisy or
 * blind without anything failing.
 */

function box(
    id: string,
    kind: SpatialBox['kind'],
    center: [number, number, number],
    size = 0.4,
    occluder = false,
): SpatialBox {
    const half = size / 2;
    return {
        id,
        name: id,
        kind,
        occluder,
        min: [center[0] - half, center[1] - half, center[2] - half],
        max: [center[0] + half, center[1] + half, center[2] + half],
    };
}

test('two bodies in the same place are reported as an overlap', () => {
    const issues = checkOverlaps([box('a', 'actor', [0, 0.9, 0]), box('b', 'actor', [0.05, 0.9, 0])], 1);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, 'overlap');
    assert.equal(issues[0].severity, 'error');
    assert.deepEqual(issues[0].ids.sort(), ['a', 'b']);
});

test('separated bodies produce no overlap', () => {
    assert.deepEqual(checkOverlaps([box('a', 'actor', [0, 0.9, 0]), box('b', 'actor', [2, 0.9, 0])], 1), []);
});

test('a character inside a prop is reported against that prop', () => {
    const issues = checkOverlaps([box('a', 'actor', [0, 0.9, 0]), box('chair', 'prop', [0, 0.45, 0], 0.6, true)], 2);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 'warning');
    assert.ok(issues[0].message.includes('chair'));
});

test('crowding flags a close but non-overlapping pair, and skips true overlaps', () => {
    // Bodies are 0.4 m wide, so 0.3 m apart already intersects and belongs to checkOverlaps.
    const close = checkCrowding([box('a', 'actor', [0, 0.9, 0]), box('b', 'actor', [0.3, 0.9, 0])], 1);
    assert.deepEqual(close, []);
    // Just outside the body but inside the conversational distance is the crowding band.
    const band = checkCrowding([box('a', 'actor', [0, 0.9, 0]), box('b', 'actor', [0.35, 0.9, 0], 0.2)], 1);
    assert.equal(band.length, 1);
    assert.equal(band[0].kind, 'crowd');
});

test('an identity camera frames a point at its centre and rejects a point behind it', () => {
    const identity = {
        projectionMatrix: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        matrixWorldInverse: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    };
    // The camera looks down -Z in view space, so a framed point has negative z.
    assert.equal(isInFrame([0.2, 0.2, -0.5], identity), true);
    assert.equal(isInFrame([2, 0, -0.5], identity), false);
    // Behind the lens never counts, however small the screen-space coordinates look.
    assert.equal(isInFrame([0, 0, 1], identity), false);
    assert.equal(isInFrame([0, 0, 0], identity), false);
});

test('repeated issues collapse into one row instead of one row per sample', () => {
    const repeated = [0, 0.25, 0.5, 0.75, 3].map((time) => ({
        kind: 'overlap' as const,
        time,
        ids: ['a', 'b'],
        message: 'overlap',
        severity: 'error' as const,
    }));
    const grouped = groupIssues(repeated, 4);
    assert.equal(grouped.length, 2);
    assert.equal(grouped[0].time, 0);
    // A later run of the same pair is a separate row, not a merge with the first run.
    assert.equal(grouped[1].time, 3);
});

test('a gap larger than the tolerance starts a new row', () => {
    const gap = [0, 2].map((time) => ({
        kind: 'crowd' as const,
        time,
        ids: ['a', 'b'],
        message: 'close',
        severity: 'warning' as const,
    }));
    assert.equal(groupIssues(gap, 4).length, 2);
});

test('reports are serialisable and readable', () => {
    const project = { name: '测试场景', fps: 24 } as Project;
    const issues = [
        { kind: 'overlap' as const, time: 1.5, ids: ['a', 'b'], message: '重叠', severity: 'error' as const },
    ];
    const json = JSON.parse(spatialReportJson(issues, project, { start: 0, end: 3 }));
    assert.equal(json.project, '测试场景');
    assert.equal(json.issues[0].time, 1.5);
    const text = spatialReportText(issues, project, { start: 0, end: 3 });
    assert.ok(text.includes('测试场景'));
    assert.ok(text.includes('1 项待确认'));
    assert.ok(spatialReportText([], project, { start: 0, end: 3 }).includes('未发现'));
});

test('toSpatialBox converts three.js-style bounds into plain numbers', () => {
    const converted = toSpatialBox(
        'x',
        'Box',
        'prop',
        { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } },
        true,
    );
    assert.deepEqual(converted.min, [-1, 0, -1]);
    assert.deepEqual(converted.max, [1, 2, 1]);
    assert.equal(converted.occluder, true);
});
