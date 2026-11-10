import { DeleteOutlined } from '@ant-design/icons';
import { App } from 'antd';
import { useEffect, useState } from 'react';
import { InspectorPanel } from '@/features/inspector/inspector-panel.tsx';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { SceneSidebar } from '@/features/sidebar/scene-sidebar.tsx';
import { StageViewport } from '@/features/stage/stage-viewport.tsx';
import { TimelinePanel } from '@/features/timeline/timeline-panel.tsx';
import { TopBar } from '@/features/top-bar/top-bar.tsx';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import './editor-page.css';

const isTextField = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function EditorPage() {
    const t = useTranslation();
    const { modal } = App.useApp();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [timelineHeight, setTimelineHeight] = useState<number | null>(null);
    /**
     * One frame loop for the whole editor: advance playback, let the engine draw, then
     * publish the playhead at ~20 Hz so React is not re-rendered on every frame.
     */
    useEffect(() => {
        let previous = performance.now();
        let request = 0;
        const tick = (now: number) => {
            const delta = Math.min((now - previous) / 1000, 0.1);
            previous = now;
            session.frame(delta, now);
            request = requestAnimationFrame(tick);
        };
        request = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(request);
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (isTextField(event.target)) return;
            if (event.metaKey || event.ctrlKey) {
                const key = event.key.toLowerCase();
                if (key === 'z') {
                    event.preventDefault();
                    if (event.shiftKey) session.redo();
                    else session.undo();
                    return;
                }
                if (key === 'b') {
                    event.preventDefault();
                    session.splitSelectedClip();
                    return;
                }
                if (key === 'd') {
                    event.preventDefault();
                    session.duplicateSelected();
                }
                return;
            }
            if (event.altKey) return;
            if (event.key === 'Escape' && session.timelineDragging) {
                event.preventDefault();
                session.cancelTimelineDrag();
                return;
            }
            if (useEditorStore.getState().pathDraft) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    session.finishPath();
                    return;
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    session.cancelPath();
                    return;
                }
            }
            if (event.key === '/') {
                const search = document.querySelector<HTMLInputElement>('#scene-search');
                if (search) {
                    event.preventDefault();
                    setSidebarOpen(true);
                    requestAnimationFrame(() => search.focus());
                    return;
                }
            }
            if (event.code === 'Space') {
                event.preventDefault();
                session.togglePlay();
                return;
            }
            if (event.key === '1') session.setTransformMode('translate');
            if (event.key === '2') session.setTransformMode('rotate');
            if (event.key === '3') session.setTransformMode('scale');
            const canvasFocused = document.activeElement instanceof HTMLCanvasElement;
            if ((event.key === 'f' || event.key === 'F') && !canvasFocused) session.focusSelected();
            if (event.key === 'Delete' || event.key === 'Backspace') {
                const entity = session.current();
                if (!entity) return;
                event.preventDefault();
                modal.confirm({
                    className: 'delete-confirm',
                    icon: <DeleteOutlined />,
                    centered: true,
                    width: 400,
                    title: `${t('删除对象')}「${entity.name}」`,
                    content: t('删除后可用撤销恢复。'),
                    okText: t('删除'),
                    okButtonProps: { danger: true },
                    cancelText: t('取消'),
                    onOk: () => {
                        session.deleteSelected();
                    },
                });
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [modal, t]);

    return (
        <div
            className={`editor ${sidebarOpen ? 'editor--sidebar-open' : 'editor--sidebar-closed'}`}
            style={
                timelineHeight === null
                    ? undefined
                    : ({ '--timeline-height': `${timelineHeight}px` } as React.CSSProperties)
            }
        >
            <TopBar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((open) => !open)} />
            <div className="editor__body">
                <SceneSidebar />
                <StageViewport />
                <InspectorPanel />
            </div>
            <TimelinePanel onHeightChange={setTimelineHeight} onHeightReset={() => setTimelineHeight(null)} />
        </div>
    );
}
