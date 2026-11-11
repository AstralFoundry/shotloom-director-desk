import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderLease } from '../src/core/editor/render-lease.ts';

/**
 * The lease is the only thing standing between "render a frame at another time" and "the viewport
 * shows the wrong frame". Each assertion here maps to a way the naive version broke.
 */

/** Minimal engine stand-in: only the fields the lease actually touches. */
function fakeEngine() {
    const calls: string[] = [];
    return {
        calls,
        time: 0,
        exporting: false,
        /** Records the sampled time so tests can see interleaving. */
        sample(time: number) {
            this.time = time;
            calls.push(`sample:${time}`);
        },
        restorePreview(time: number) {
            this.time = time;
            calls.push(`restore:${time}`);
        },
    };
}

test('the borrowed time is restored, and exporting is released', async () => {
    const engine = fakeEngine();
    const lease = new RenderLease(engine as never);
    engine.time = 5;

    await lease.borrow(() => {
        engine.sample(120);
        assert.equal(engine.time, 120, '借用期间引擎应停在借用时间');
    });

    assert.equal(engine.time, 5, '借出后必须回到原来的时间');
    assert.equal(engine.exporting, false, '借出结束后必须释放 exporting');
    assert.deepEqual(engine.calls, ['sample:120', 'restore:5']);
});

test('a throwing borrow still restores the engine and does not wedge the queue', async () => {
    const engine = fakeEngine();
    const lease = new RenderLease(engine as never);
    engine.time = 3;

    await assert.rejects(
        lease.borrow(() => {
            engine.sample(90);
            throw new Error('渲染失败');
        }),
        /渲染失败/,
    );
    assert.equal(engine.time, 3, '抛错也要回到原时间，否则视口与播放头不一致');
    assert.equal(engine.exporting, false, '抛错不能把 exporting 卡在 true');

    // The next borrow must still run: a failed borrow may not poison the chain.
    const value = await lease.borrow(() => 'ok');
    assert.equal(value, 'ok');
});

test('concurrent borrows are serialised, never interleaved', async () => {
    const engine = fakeEngine();
    const lease = new RenderLease(engine as never);
    const order: string[] = [];

    const slow = lease.borrow(async () => {
        order.push('a:start');
        engine.sample(10);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('a:end');
    });
    const fast = lease.borrow(() => {
        order.push('b:start');
        engine.sample(20);
        order.push('b:end');
    });

    await Promise.all([slow, fast]);
    // Without the queue b's sample would land in the middle of a's work.
    assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end']);
});

test('an outer export is not cleared by an inner borrow', async () => {
    const engine = fakeEngine();
    const lease = new RenderLease(engine as never);
    engine.exporting = true;

    await lease.borrow(() => 'done');
    assert.equal(engine.exporting, true, '外层导出正在进行时，借用不得把 exporting 清掉');
});

test('borrowing during an export still restores the engine time', async () => {
    const engine = fakeEngine();
    const lease = new RenderLease(engine as never);
    engine.exporting = true;
    engine.time = 7;

    await lease.borrow(() => {
        engine.sample(200);
    });

    // Even when the borrow declines to take ownership, the caller's time must come back.
    assert.equal(engine.time, 7);
    assert.equal(engine.exporting, true, '外层导出状态保持不动');
});

test('shouldSkip abandons the work without touching the engine', async () => {
    const engine = fakeEngine();
    const lease = new RenderLease(engine as never);
    engine.time = 4;

    const result = await lease.borrow(
        () => 'ran',
        () => true,
    );
    assert.equal(result, undefined);
    assert.equal(engine.exporting, false);
    assert.equal(engine.time, 4);
});

test('busy reflects an in-flight borrow', async () => {
    const engine = fakeEngine();
    const lease = new RenderLease(engine as never);
    assert.equal(lease.busy, false);

    let insideBusy = false;
    await lease.borrow(() => {
        insideBusy = lease.busy;
    });
    assert.equal(insideBusy, true, '借用期间 busy 应为 true，界面据此禁用冲突操作');
    assert.equal(lease.busy, false);
});
