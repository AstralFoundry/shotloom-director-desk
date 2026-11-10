import * as THREE from 'three';
import { Engine } from '@/core/engine.ts';
import { SceneWorkspace } from '@/core/scenes/scene-workspace.ts';
import { assertProject, type CameraConfig, type Entity, type Joint, type Project, type Vec3 } from '@/core/model.ts';
import { entityPosition, shiftPath } from '@/core/timeline.ts';
import type { TimelineSelection } from '@/core/clip-editing.ts';
import { selectedEntities, setSelectedEntities } from '@/core/editor/timeline-selection.ts';
import { assertLockedEntitiesUnchanged } from '@/core/editor/invariants.ts';
import { recordPositionKey } from '@/core/editor/position-keys.ts';
import { editBoundTransform } from '@/core/animation/hand-binding.ts';
import { freezeCamera } from '@/core/editor/camera-editing.ts';
import { bindNavigation } from '@/core/editor/navigation.ts';
import { setJointRotation } from '@/core/editor/joint-editing.ts';
import { RecoveryAutosave } from '@/core/editor/recovery-autosave.ts';
import { autosave, recoverSession } from '@/core/storage.ts';
import { prepareDocumentModels } from '@/core/scenes/document-models.ts';
import { createScene, type SceneTemplate } from '@/core/scene-templates.ts';
import { readSceneDocument } from '@/core/scenes/sequence-project.ts';
import { type LightConfig, type LightingConfig } from '@/core/lighting/model.ts';
import { notifyError, notifySuccess } from '@/shared/ui/feedback.ts';
import { useStageOverlayStore } from './stage-overlay-store.ts';
import { inspectorTabsFor } from './inspector-tabs.ts';
import {
    useEditorStore,
    type EditorPatch,
    type InspectorTab,
    type TransformMode,
    type ViewMode,
} from './editor-store.ts';
import { ClipCommands } from './commands/clips.ts';
import { EntityCommands } from './commands/entity.ts';
import { PathCommands } from './commands/path.ts';
import { PoseCommands } from './commands/pose.ts';
import { SceneCommands } from './commands/scene.ts';
import type { CameraPresetId } from '@/core/cinematography/camera-presets.ts';
import type { FramingName } from './commands/scene.ts';
import { TimelineCommands } from './commands/timeline.ts';
import type { EditorCommandHost } from './commands/host.ts';

/** How often the session republishes the playhead to React while playing (ms). */
const UI_TIME_STEP = 50;

/**
 * Owns everything that is not React: the project, undo history, the three.js engine and
 * the editor commands that connect them. React components read the store and call these
 * methods; they never mutate the project or touch the engine directly.
 */
export class EditorSession {
    readonly history: SceneWorkspace;
    private engineRef: Engine | null = null;
    private transformError: Error | undefined;
    private cameraViewDragId: string | null = null;
    private clock = 0;
    private lastUiSync = 0;
    private lastOverlaySync = 0;
    private lastOverlaySignature = '';
    private recoveryStarted = false;
    private recoveryAbort: AbortController | null = null;
    private navigation: ReturnType<typeof bindNavigation> | null = null;
    private readonly host: EditorCommandHost;
    private readonly timeline: TimelineCommands;
    private readonly clips: ClipCommands;
    private readonly pose: PoseCommands;
    private readonly path: PathCommands;
    private readonly scene: SceneCommands;
    private readonly entity: EntityCommands;
    private readonly autosave: RecoveryAutosave;

    constructor() {
        const project = useEditorStore.getState().project;

        this.history = new SceneWorkspace(project, () => {
            const state = useEditorStore.getState();
            return { time: state.time, selected: state.selected, preview: state.preview };
        });

        const session = this;
        this.host = {
            get project() {
                return useEditorStore.getState().project;
            },
            get engine() {
                return session.engineRef;
            },
            get history() {
                return session.history;
            },
            get clock() {
                return session.clock;
            },
            setClock(seconds: number) {
                session.clock = seconds;
            },
            current: () => this.current(),
            patch: (partial) => this.apply(partial),
            change: (fn, rebuild) => this.change(fn, rebuild),
            changed: (rebuild) => this.changed(rebuild),
            extendDuration: () => this.extendDuration(),
            setView: (view) => this.setView(view),
            finishPath: () => this.finishPath(),
            cancelPath: () => this.cancelPath(),
            selectEntity: (id, preserve) => this.selectEntity(id, preserve),
            seek: (seconds, defer) => this.seek(seconds, defer),
        };
        this.timeline = new TimelineCommands(this.host);
        this.clips = new ClipCommands(this.host);
        this.pose = new PoseCommands(this.host);
        this.path = new PathCommands(this.host);
        this.scene = new SceneCommands(this.host);
        this.entity = new EntityCommands(this.host);

        this.autosave = new RecoveryAutosave(
            (force) =>
                autosave(
                    () => {
                        const state = useEditorStore.getState();
                        const blocked = this.history.pending || this.engineRef?.dragging || (state.busy && !force);
                        return blocked ? null : this.history.document();
                    },
                    () => ({ path: this.history.filePath, dirty: this.history.dirty }),
                ),
            () => this.apply({ dirty: false, status: '自动备份已保存' }),
            (error) => {
                this.apply({ status: '请手动导出项目备份' });
                notifyError(`自动备份失败：${(error as Error).message}`);
            },
        );
    }

    /**
     * Restore the last automatic backup once the engine is mounted. Any edit made while the
     * read is in flight wins: recovery only applies when the revision is untouched.
     */
    async restoreRecovery(): Promise<void> {
        if (this.recoveryStarted || !this.engineRef) return;
        this.recoveryStarted = true;
        const engine = this.engineRef;
        const controller = new AbortController();
        this.recoveryAbort = controller;
        const startedAt = useEditorStore.getState().revision;
        try {
            const restored = await recoverSession();
            if (!restored) return;
            const state = useEditorStore.getState();
            if (state.revision !== startedAt || state.busy || this.history.pending || state.pathDraft) return;
            await prepareDocumentModels(engine.externalModels, restored.document, controller.signal);
            if (this.engineRef !== engine || controller.signal.aborted) return;
            const current = useEditorStore.getState();
            if (current.revision !== startedAt || this.history.pending) {
                engine.externalModels.retain([this.project, ...this.history.undoStack, ...this.history.redoStack]);
                return;
            }
            const project = this.history.reset(restored.document);
            const selected = this.history.restoredSelection ?? project.entities[0]?.id ?? '';
            this.history.setFile(restored.file.path, !restored.file.dirty);
            this.clock = 0;
            this.apply({
                project,
                selected,
                time: 0,
                preview: 'program',
                dirty: this.history.dirty,
                status: this.history.dirty ? '自动备份已保存' : '项目已保存',
            });
            engine.selected = selected;
            this.changed(true);
            notifySuccess('已恢复上次工作');
        } catch (error) {
            if (!controller.signal.aborted && this.engineRef === engine)
                notifyError('未能读取自动恢复或模型资源，可以继续使用当前场景');
        } finally {
            if (this.recoveryAbort === controller) this.recoveryAbort = null;
        }
    }

    get project(): Project {
        return useEditorStore.getState().project;
    }

    /** The engine exists only while the stage viewport is mounted. */
    get engine(): Engine {
        if (!this.engineRef) throw new Error('三维引擎尚未挂载');
        return this.engineRef;
    }

    get engineOrNull(): Engine | null {
        return this.engineRef;
    }

    current(): Entity | undefined {
        const { project, selected } = useEditorStore.getState();
        return project.entities.find((e) => e.id === selected);
    }

    private apply(partial: EditorPatch): void {
        useEditorStore.getState().patch(partial);
    }

    /* ------------------------------------------------------------------ */
    /* Engine lifecycle                                                    */
    /* ------------------------------------------------------------------ */

    attachEngine(stage: HTMLElement, shot: HTMLElement): void {
        if (this.engineRef) return;
        const engine = new Engine(this.project, stage, shot, {
            selection: () => selectedEntities(),
            select: (id) => this.selectEntity(id),
            point: (index) => {
                engine.select(useEditorStore.getState().selected, index);
                this.apply({ inspectorTab: 'path' });
            },
            ground: (point) => this.addGroundPoint(point),
            stroke: (points) => this.addFreehandStroke(points),
            joint: () => this.apply({ inspectorTab: 'pose', selectedJoint: engine.selectedJoint }),
            transformStart: () => this.beginTransform(),
            transform: (position, rotation, scale) => this.applyTransform(position, rotation, scale),
            transformEnd: (cancel) => this.endTransform(cancel),
            cameraViewStart: (cameraId) => this.beginCameraViewDrag(cameraId),
            cameraViewChange: (rotation) => this.updateCameraViewDrag(rotation),
            cameraViewEnd: (cancel) => this.endCameraViewDrag(cancel),
        });
        this.engineRef = engine;
        engine.jointNodesVisible = useEditorStore.getState().inspectorTab === 'pose';
        this.navigation = bindNavigation({
            get engine() {
                return engine;
            },
            get mode() {
                return useEditorStore.getState().view;
            },
            get busy() {
                return useEditorStore.getState().busy;
            },
            blocked: () =>
                Boolean(document.querySelector('.ant-modal')) ||
                Boolean(useEditorStore.getState().pathDraft) ||
                Boolean(useEditorStore.getState().busy),
        });
        engine.previewId = useEditorStore.getState().preview;
        engine.pathDrawMode = useEditorStore.getState().pathDrawMode;
        engine.pathSurfaceMode = useEditorStore.getState().pathSurfaceMode;
        engine.pathDrawDuration = useEditorStore.getState().pathDrawDuration;
        engine.onFrame = () => this.publishOverlay();
        engine.select(useEditorStore.getState().selected);
        this.apply({ engineReady: true });
        this.publishOverlay(true);
        void this.restoreRecovery();
    }

    detachEngine(): void {
        // A recovery read started on the previous mount must not publish into the next one.
        this.recoveryAbort?.abort();
        this.recoveryAbort = null;
        this.recoveryStarted = false;
        this.navigation?.dispose();
        this.navigation = null;
        this.engineRef?.dispose();
        this.engineRef = null;
        this.lastOverlaySignature = '';
        useStageOverlayStore.getState().patch({ labels: [], selected: '' });
        this.apply({ engineReady: false });
    }

    /**
     * Push projected object labels into the viewport overlay. Throttled to ~30 Hz and
     * skipped when the projection is pixel-identical, so idle scenes cost nothing.
     */
    private publishOverlay(force = false): void {
        const engine = this.engineRef;
        if (!engine) return;
        const now = performance.now();
        if (!force && now - this.lastOverlaySync < 33) return;
        this.lastOverlaySync = now;

        const labels = engine.getProjectedLabels();
        const signature = `${engine.selected}|${labels
            .map(
                (label) =>
                    `${label.id}:${label.name}:${label.color}:${Math.round(label.x)},${Math.round(label.y)},${label.visible ? 1 : 0}`,
            )
            .join(';')}`;
        if (signature === this.lastOverlaySignature) return;
        this.lastOverlaySignature = signature;
        useStageOverlayStore.getState().patch({ labels, selected: engine.selected });
    }

    /* ------------------------------------------------------------------ */
    /* Timeline                                                            */
    /* ------------------------------------------------------------------ */

    /** Advance and draw one animation frame. Called by the editor page's rAF loop. */
    frame(deltaSeconds: number, now: number): void {
        const engine = this.engineRef;
        if (!engine) return;
        const state = useEditorStore.getState();
        if (state.busy || engine.exporting) {
            engine.render(false);
            return;
        }

        let playing = state.playing;
        if (playing) {
            this.clock += deltaSeconds;
            if (this.clock >= this.project.duration) {
                if (state.loop && this.project.duration > 0) this.clock %= this.project.duration;
                else {
                    this.clock = this.project.duration;
                    playing = false;
                    this.apply({ playing: false });
                }
            }
        }

        this.navigation?.update(deltaSeconds);
        if (playing || this.clock !== engine.time || this.history.pending || engine.dragging) engine.sample(this.clock);
        engine.render(false);

        if (now - this.lastUiSync >= UI_TIME_STEP) {
            this.lastUiSync = now;
            if (Math.abs(state.time - this.clock) > 1e-4) this.apply({ time: this.clock });
        }
    }

    /* ------------------------------------------------------------------ */
    /* Selection & view                                                    */
    /* ------------------------------------------------------------------ */

    selectEntity(id: string, preserveTimelineSelection = false): void {
        if (useEditorStore.getState().pathDraft) this.finishPath();
        const project = this.project;
        const entity = project.entities.find((e) => e.id === id);
        if (!entity) return;
        if (!preserveTimelineSelection) setSelectedEntities([id]);

        const current = useEditorStore.getState().inspectorTab;
        const available = inspectorTabsFor(entity);
        let tab: InspectorTab = current;
        if (entity.light) tab = 'light';
        else if (entity.kind === 'camera') tab = 'camera';
        else if (!available.includes(current)) tab = 'base';

        this.apply({ selected: id, inspectorTab: tab, selectedJoint: '' });
        this.engineRef?.select(id);
    }

    selectScene(): void {
        if (useEditorStore.getState().pathDraft) this.finishPath();
        setSelectedEntities([]);
        this.apply({ selected: '', inspectorTab: 'environment', selectedJoint: '' });
        this.engineRef?.select('');
    }

    setView(view: ViewMode): void {
        this.apply({ view });
        this.engineRef?.requestResize();
    }

    setPreview(cameraId: string): void {
        this.apply({ preview: cameraId });
        if (this.engineRef) this.engineRef.previewId = cameraId;
    }

    setTransformMode(mode: TransformMode): void {
        this.engineRef?.setTransformMode(mode);
        this.apply({ transformMode: mode });
    }

    setInspectorTab(tab: InspectorTab): void {
        this.apply({ inspectorTab: tab });
        const engine = this.engineRef;
        if (engine) {
            engine.jointNodesVisible = tab === 'pose';
            engine.render();
        }
    }

    /* ------------------------------------------------------------------ */
    /* Transactions                                                        */
    /* ------------------------------------------------------------------ */

    change(fn: () => void, rebuild = true): boolean {
        if (useEditorStore.getState().busy) return false;
        if (this.history.pending) {
            notifyError('请先完成或取消当前拖动操作');
            return false;
        }
        this.apply({ playing: false });
        const project = this.project;
        this.history.begin(project);
        try {
            fn();
            if (this.project === project) assertLockedEntitiesUnchanged(this.history.pending!, project);
            assertProject(this.project);
            this.engineRef?.externalModels.assertReady(this.project);
            this.history.commit(this.project);
            this.changed(rebuild);
            return true;
        } catch (error) {
            const restored = this.history.rollback();
            if (restored) this.apply({ project: restored });
            const selected = this.history.restoredSelection ?? useEditorStore.getState().selected;
            this.apply({ selected });
            if (this.engineRef) {
                this.engineRef.selected = selected;
                this.engineRef.rebuild(this.project);
            }
            this.changed(true);
            notifyError((error as Error).message);
            return false;
        }
    }

    /** Re-publish editor state after a project mutation (or a rebuilt engine scene). */
    changed(rebuild = true): void {
        const project = this.project;
        const state = useEditorStore.getState();
        let selected = state.selected;
        if (!project.entities.some((e) => e.id === selected))
            selected = project.entities.find((e) => e.kind === 'actor')?.id ?? project.entities[0]?.id ?? '';

        const dirty = this.history.dirty;
        this.apply({
            revision: state.revision + 1,
            dirty,
            selected,
            status: dirty ? '正在自动备份…' : '项目已保存',
        });

        const engine = this.engineRef;
        if (engine) {
            engine.selected = selected;
            engine.previewId = state.preview;
            engine.project = project;
            if (rebuild) engine.rebuild(project);
            else {
                engine.project = project;
                engine.sample(this.clock);
                engine.refreshHelpers();
            }
            engine.select(selected, engine.selectedPoint);
            engine.externalModels.retain([project, ...this.history.undoStack, ...this.history.redoStack]);
        }
        this.autosave.request();
    }

    undo(): void {
        if (useEditorStore.getState().pathDraft) {
            this.cancelPath();
            return;
        }
        this.apply({ playing: false });
        const project = this.history.undo(this.project);
        if (!project) return;
        this.apply({ project, selected: this.history.restoredSelection ?? useEditorStore.getState().selected });
        if (this.history.restoredView) {
            this.clock = this.history.restoredView.time;
            this.apply({ time: this.clock, preview: this.history.restoredView.preview });
        }
        this.changed();
    }

    redo(): void {
        this.apply({ playing: false });
        const project = this.history.redo(this.project);
        if (!project) return;
        this.apply({ project, selected: this.history.restoredSelection ?? useEditorStore.getState().selected });
        if (this.history.restoredView) {
            this.clock = this.history.restoredView.time;
            this.apply({ time: this.clock, preview: this.history.restoredView.preview });
        }
        this.changed();
    }

    /** Long-running work (export) that must pause the editor without touching history. */
    beginBusy(): void {
        this.apply({ playing: false, busy: true });
    }

    endBusy(): void {
        this.apply({ busy: false });
        this.changed(false);
    }

    /**
     * Toggle the busy flag without publishing a project change. Used by flows that stage
     * engine resources (model import) where `changed()` would prune unprepared sources.
     */
    setBusy(busy: boolean): void {
        this.apply({ busy });
    }

    extendDuration(): void {
        const project = this.project;
        for (const e of project.entities) {
            project.duration = Math.max(
                project.duration,
                ...e.clips.map((c) => c.end),
                ...(e.path?.sections?.map((s) => s.end) ?? e.path?.points.map((p) => p.time) ?? []),
                ...e.poseKeys.map((k) => k.time),
                ...(e.camera?.targetPath?.points.map((p) => p.time) ?? []),
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /* Timeline dragging                                                   */
    /* ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ */
    /* Action clips                                                        */
    /* ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ */
    /* Pose & joints                                                       */
    /* ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ */
    /* Path drawing                                                        */
    /* ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ */
    /* Entity & scene commands                                             */
    /* ------------------------------------------------------------------ */

    /** Replace the current scene with a fresh template (undoable, keeps autosave state). */
    newProject(template: SceneTemplate = 'blank'): boolean {
        const state = useEditorStore.getState();
        const engine = this.engineRef;
        if (!engine) return false;
        if (state.busy || this.history.pending || state.pathDraft || engine.exporting) {
            notifyError('请先完成当前编辑或导出');
            return false;
        }
        try {
            const document = readSceneDocument(createScene(template));
            const project = this.history.replace(document, this.history.context, '新建工程', true);
            const selected =
                project.entities.find((entity) => entity.kind === 'actor')?.id ?? project.entities[0]?.id ?? '';
            this.clock = 0;
            this.apply({
                project,
                selected,
                time: 0,
                preview: 'program',
                playing: false,
                selectedClipId: null,
                selectedPoint: -1,
                selectedJoint: '',
                inspectorTab: 'base',
                sidebarTab: 'scene',
                query: '',
            });
            engine.selected = selected;
            this.changed(true);
            engine.viewHome();
            notifySuccess('已新建工程');
            return true;
        } catch (error) {
            notifyError((error as Error).message);
            return false;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Command facade                                                      */
    /* ------------------------------------------------------------------ */

    seek(seconds: number, deferSample = false): void {
        this.timeline.seek(seconds, deferSample);
    }

    togglePlay(): void {
        this.timeline.togglePlay();
    }

    stepFrame(direction: 1 | -1): void {
        this.timeline.stepFrame(direction);
    }

    setLoop(loop: boolean): void {
        this.timeline.setLoop(loop);
    }

    addCutAtPlayhead(): void {
        this.timeline.addCutAtPlayhead();
    }

    removeCut(index: number): void {
        this.timeline.removeCut(index);
    }

    setDuration(seconds: number): void {
        this.timeline.setDuration(seconds);
    }

    get timelineDragging(): boolean {
        return this.clips.timelineDragging;
    }

    beginTimelineDrag(selection: TimelineSelection, resize: boolean): boolean {
        return this.clips.beginTimelineDrag(selection, resize);
    }

    updateTimelineDrag(deltaSeconds: number): void {
        this.clips.updateTimelineDrag(deltaSeconds);
    }

    endTimelineDrag(): void {
        this.clips.endTimelineDrag();
    }

    cancelTimelineDrag(): void {
        this.clips.cancelTimelineDrag();
    }

    selectClip(id: string | null): void {
        this.clips.selectClip(id);
    }

    addAction(action: string): void {
        this.clips.addAction(action);
    }

    setClipField(id: string, patch: Partial<Pick<Entity['clips'][number], 'start' | 'end' | 'speed'>>): void {
        this.clips.setClipField(id, patch);
    }

    removeClip(id: string): void {
        this.clips.removeClip(id);
    }

    splitSelectedClip(): void {
        this.clips.splitSelectedClip();
    }

    setFootContact(value: boolean): void {
        this.clips.setFootContact(value);
    }

    setActionBlend(value: number): void {
        this.clips.setActionBlend(value);
    }

    selectJoint(joint: Joint | ''): void {
        this.pose.selectJoint(joint);
    }

    setJointNodesVisible(visible: boolean): void {
        this.pose.setJointNodesVisible(visible);
    }

    setJointAngle(joint: Joint, axis: 0 | 1 | 2, degrees: number): void {
        this.pose.setJointAngle(joint, axis, degrees);
    }

    resetPose(): void {
        this.pose.resetPose();
    }

    mirrorPose(): void {
        this.pose.mirrorPose();
    }

    recordPoseKey(): void {
        this.pose.recordPoseKey();
    }

    seekPoseKey(index: number): void {
        this.pose.seekPoseKey(index);
    }

    deletePoseKey(index: number): void {
        this.pose.deletePoseKey(index);
    }

    jointState(entity: Entity): { joints: Array<[string, string]>; angles: [number, number, number] } {
        return this.pose.jointState(entity);
    }

    setPathDrawMode(mode: 'points' | 'freehand'): void {
        this.path.setPathDrawMode(mode);
    }

    setPathSurfaceMode(mode: 'surface' | 'ground'): void {
        this.path.setPathSurfaceMode(mode);
    }

    setPathDrawDuration(seconds: number): void {
        this.path.setPathDrawDuration(seconds);
    }

    startPath(): void {
        this.path.startPath();
    }

    addGroundPoint(position: Vec3): void {
        this.path.addGroundPoint(position);
    }

    addFreehandStroke(points: Vec3[]): void {
        this.path.addFreehandStroke(points);
    }

    finishPath(): void {
        this.path.finishPath();
    }

    cancelPath(): void {
        this.path.cancelPath();
    }

    clearPath(): void {
        this.path.clearPath();
    }

    selectPathPoint(index: number): void {
        this.path.selectPathPoint(index);
    }

    setPathPointTime(index: number, seconds: number): void {
        this.path.setPathPointTime(index, seconds);
    }

    setPathPointPosition(index: number, axis: 0 | 1 | 2, value: number): void {
        this.path.setPathPointPosition(index, axis, value);
    }

    appendPathPoint(): void {
        this.path.appendPathPoint();
    }

    removePathPoint(index: number): void {
        this.path.removePathPoint(index);
    }

    holdPathPoint(): void {
        this.path.holdPathPoint();
    }

    addAsset(assetId: string): boolean {
        return this.scene.addAsset(assetId);
    }

    addCamera(fromView = false): void {
        this.scene.addCamera(fromView);
    }

    snapshot(): Promise<void> {
        return this.scene.snapshot();
    }

    updateProjectSettings(patch: { name?: string; aspect?: string; fps?: number }): boolean {
        return this.scene.updateProjectSettings(patch);
    }

    applyFraming(name: FramingName): boolean {
        return this.scene.applyFraming(name);
    }

    updateRoom(patch: Partial<Project['room']>): boolean {
        return this.scene.updateRoom(patch);
    }

    setLightingField(patch: Partial<LightingConfig>): void {
        this.scene.setLightingField(patch);
    }

    setCameraField(patch: Partial<CameraConfig>): void {
        this.scene.setCameraField(patch);
    }

    applyCameraPreset(id: CameraPresetId): boolean {
        return this.scene.applyCameraPreset(id);
    }

    toggleGrid(): void {
        this.scene.toggleGrid();
    }

    viewHome(): void {
        this.scene.viewHome();
    }

    viewTop(): void {
        this.scene.viewTop();
    }

    focusSelected(): void {
        this.scene.focusSelected();
    }

    renameEntity(name: string): void {
        this.entity.renameEntity(name);
    }

    duplicateSelected(): void {
        this.entity.duplicateSelected();
    }

    deleteSelected(replacementCamera?: string): boolean {
        return this.entity.deleteSelected(replacementCamera);
    }

    groundSelected(): void {
        this.entity.groundSelected();
    }

    setEntityColor(color: string): void {
        this.entity.setEntityColor(color);
    }

    setEntityFlag(key: 'visible' | 'locked', value: boolean): void {
        this.entity.setEntityFlag(key, value);
    }

    setPositionAxis(axis: 0 | 1 | 2, value: number): void {
        this.entity.setPositionAxis(axis, value);
    }

    setRotationAxis(axis: 0 | 1 | 2, degrees: number): void {
        this.entity.setRotationAxis(axis, degrees);
    }

    setScaleAxis(axis: 0 | 1 | 2, value: number): void {
        this.entity.setScaleAxis(axis, value);
    }

    setHeight(value: number): void {
        this.entity.setHeight(value);
    }

    setEntityOption(key: 'build' | 'gender', value: string): void {
        this.entity.setEntityOption(key, value);
    }

    setLightField(patch: Partial<LightConfig>): void {
        this.entity.setLightField(patch);
    }

    /* ------------------------------------------------------------------ */
    /* three.js transform bridge                                           */
    /* ------------------------------------------------------------------ */

    private beginCameraViewDrag(cameraId: string): boolean {
        const camera = this.project.entities.find((entity) => entity.id === cameraId && entity.kind === 'camera');
        const engine = this.engineRef;
        if (!camera?.camera || camera.locked || !engine || this.history.pending || useEditorStore.getState().busy)
            return false;
        this.apply({ playing: false });
        this.history.begin(this.project);
        if (camera.camera.mode !== 'free') freezeCamera(engine, camera);
        else {
            const live = engine.getShotCamera(cameraId);
            camera.rotation = [live.rotation.x, live.rotation.y, live.rotation.z];
            camera.camera.aim = 'manual';
        }
        this.cameraViewDragId = cameraId;
        this.selectEntity(cameraId);
        return true;
    }

    private updateCameraViewDrag(rotation: Vec3): void {
        if (!this.cameraViewDragId) return;
        const camera = this.project.entities.find((entity) => entity.id === this.cameraViewDragId);
        if (!camera?.camera) return;
        camera.rotation = rotation;
        this.engineRef?.sample(this.clock);
        this.engineRef?.refreshHelpers();
    }

    private endCameraViewDrag(cancel = false): void {
        if (!this.cameraViewDragId) return;
        this.cameraViewDragId = null;
        try {
            if (cancel) throw new Error('已取消机位调整');
            assertLockedEntitiesUnchanged(this.history.pending!, this.project);
            assertProject(this.project);
            this.history.commit(this.project);
            this.changed(false);
        } catch (error) {
            const restored = this.history.rollback();
            if (restored) this.apply({ project: restored, selected: this.history.restoredSelection ?? '' });
            this.changed(true);
            if (!cancel) notifyError((error as Error).message);
        }
    }

    private beginTransform(): void {
        this.transformError = undefined;
        this.apply({ playing: false });
        this.history.begin(this.project);
        const e = this.current();
        if (e?.camera && e.camera.mode !== 'free') freezeCamera(this.engine, e);
    }

    private applyTransform(position: Vec3, rotation: Vec3, scale: Vec3): void {
        const engine = this.engineRef;
        const e = this.current();
        if (!engine || !e || this.transformError) return;

        if (engine.selectedJoint) {
            const angles = engine.jointRotation(rotation);
            if (angles) setJointRotation(e, engine.selectedJoint as Joint, angles, this.clock, this.project.fps);
            engine.sample(this.clock);
            return;
        }
        if (e.handBinding && engine.gizmo.getMode() !== 'scale') {
            editBoundTransform(
                e,
                engine.handFrame(e.handBinding),
                engine.gizmo.getMode() === 'translate' ? position : undefined,
                engine.gizmo.getMode() === 'rotate' ? rotation : undefined,
            );
        } else if (engine.positionKeying && engine.gizmo.getMode() === 'translate') {
            try {
                recordPositionKey(e, this.clock, position, this.project.fps);
                this.extendDuration();
            } catch (error) {
                this.transformError = error as Error;
                engine.syncProxy();
                return;
            }
            engine.proxy.position.fromArray(position);
        } else if (engine.selectedPoint >= 0 && e.path) e.path.points[engine.selectedPoint].position = position;
        else if (engine.gizmo.getMode() === 'translate') {
            const snapped = engine.snapObjectPosition(e.id, position, engine.gizmo.axis ?? 'XYZ');
            const origin = entityPosition(e, this.clock);
            shiftPath(e, new THREE.Vector3(...snapped).sub(origin));
            engine.proxy.position.fromArray(snapped);
        } else if (engine.gizmo.getMode() === 'rotate') e.rotation = rotation;
        else e.scale = scale.map((v) => Math.max(0.05, v)) as Vec3;

        engine.sample(this.clock);
        engine.refreshHelpers();
    }

    private endTransform(cancel = false): void {
        const engine = this.engineRef;
        try {
            if (cancel || this.transformError) throw this.transformError ?? new Error('已取消拖动');
            assertLockedEntitiesUnchanged(this.history.pending!, this.project);
            assertProject(this.project);
            this.history.commit(this.project);
            this.changed(false);
        } catch (error) {
            const restored = this.history.rollback();
            if (restored) {
                this.apply({
                    project: restored,
                    selected: this.history.restoredSelection ?? useEditorStore.getState().selected,
                });
            }
            if (engine) {
                engine.selected = useEditorStore.getState().selected;
                engine.rebuild(this.project);
            }
            this.changed(true);
            if (!cancel) notifyError((error as Error).message);
        } finally {
            this.transformError = undefined;
        }
    }
}

/** Single session for the application shell. */
export const session = new EditorSession();
