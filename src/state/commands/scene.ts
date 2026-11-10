import * as THREE from 'three';
import { findAsset } from '@/core/asset-catalog.ts';
import { cameraPresetPath, type CameraPresetId } from '@/core/cinematography/camera-presets.ts';
import { libraryPreferences } from '@/core/assets/library-preferences.ts';
import { workingElevation } from '@/core/building/floors.ts';
import { entityPosition } from '@/core/timeline.ts';
import { ASPECTS, FRAME_RATES, COLORS, clip, entity, outputSize, type Project, type Vec3 } from '@/core/model.ts';
import type { CameraConfig } from '@/core/model.ts';
import { defaultLighting, type LightingConfig } from '@/core/lighting/model.ts';
import { download } from '@/core/storage.ts';
import { notifyError, notifySuccess } from '@/shared/ui/feedback.ts';
import { useEditorStore } from '../editor-store.ts';
import type { EditorCommandHost } from './host.ts';

/** Standard shot sizes used by the quick framing presets. */
export type FramingName = '全景' | '中景' | '近景' | '特写';

const FRAMING_HEIGHTS: Record<FramingName, number> = { 全景: 2.2, 中景: 1.15, 近景: 0.65, 特写: 0.3 };

/** Scene-level commands: catalogue assets, cameras, still export and environment. */
export class SceneCommands {
    constructor(private readonly host: EditorCommandHost) {}

    /** Place a catalogue asset on the ground under the orbit target. */
    addAsset(assetId: string): boolean {
        const asset = findAsset(assetId);
        const engine = this.host.engine;
        if (!asset || !engine) return false;
        const target = engine.orbit.target;
        const elevation = workingElevation(this.host.project);
        const added = this.host.change(() => {
            const e = entity(asset.kind, asset.id, asset.name, engine.snapPosition([target.x, elevation, target.z]));
            e.position[1] = elevation;
            if (e.light) {
                e.position[1] += 3;
                e.rotation[0] = -Math.PI / 4;
            }
            if (asset.kind === 'actor' || asset.kind === 'crowd') {
                const actors = this.host.project.entities.filter((entity) => entity.kind === 'actor').length;
                e.color = COLORS[actors % COLORS.length];
                e.clips = [clip('idle', 0, this.host.project.duration)];
            }
            this.host.project.entities.push(e);
            this.host.patch({ selected: e.id, inspectorTab: e.light ? 'light' : 'base' });
        });
        if (added) {
            libraryPreferences.used(assetId);
            engine.select(useEditorStore.getState().selected);
        }
        return added;
    }

    addCamera(fromView = false): void {
        const engine = this.host.engine;
        this.host.change(() => {
            const project = this.host.project;
            const cameras = project.entities.filter((e) => e.kind === 'camera');
            const position = (
                fromView && engine
                    ? engine.editorCamera.position.clone()
                    : new THREE.Vector3(1.8, 1.5 + workingElevation(project), 1.8)
            ).toArray() as Vec3;
            const camera = entity('camera', 'camera', String.fromCharCode(65 + cameras.length) + ' · 新机位', position);
            if (fromView && engine) {
                camera.camera!.target = engine.orbit.target.toArray() as Vec3;
                const reference = engine.editorCamera.clone();
                reference.filmGauge = 36;
                camera.camera!.focal = THREE.MathUtils.clamp(reference.getFocalLength(), 8, 300);
            }
            project.entities.push(camera);
            if (engine) engine.previewId = camera.id;
            this.host.patch({ selected: camera.id, inspectorTab: 'camera', preview: camera.id });
        });
        this.host.engine?.select(useEditorStore.getState().selected);
    }

    async snapshot(): Promise<void> {
        const engine = this.host.engine;
        if (!engine || useEditorStore.getState().busy) return;
        const at = useEditorStore.getState().time;
        this.host.patch({ playing: false, busy: true });
        engine.exporting = true;
        try {
            const [width, height] = outputSize(this.host.project.aspect, 1920);
            await engine.prepareOutput(at);
            const canvas = engine.renderOutput(at, width, height, useEditorStore.getState().preview);
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('未能生成截图');
            download(blob, `${this.host.project.name}-${at.toFixed(2)}s.png`);
            notifySuccess('已导出当前画面');
        } catch (error) {
            notifyError((error as Error).message);
        } finally {
            this.host.patch({ busy: false });
            engine.restorePreview(at);
        }
    }

    /** Project-level settings; aspect/fps rebuild the shot renderer. */
    /** Frame the target with a standard shot size, then preview that camera. */
    applyFraming(name: FramingName): boolean {
        const camera = this.host.current();
        if (camera?.kind !== 'camera' || !camera.camera) return false;
        const project = this.host.project;
        const target =
            project.entities.find((entity) => entity.id === camera.camera!.targetId) ??
            project.entities.find((entity) => entity.kind === 'actor');
        if (!target) {
            notifyError('先选择一个构图目标或添加人物');
            return false;
        }
        const engine = this.host.engine;
        if (!engine) return false;
        const applied = this.host.change(() => {
            const config = camera.camera!;
            config.targetPath = null;
            config.aim = 'target';
            config.targetId = target.id;
            const height = FRAMING_HEIGHTS[name];
            config.targetHeight =
                name === '全景' ? target.height * 0.5 : name === '中景' ? target.height * 0.67 : target.height * 0.88;
            config.mode = 'free';
            config.focal = name === '特写' ? 70 : 35;
            delete config.focalKeys;
            const shotCamera = engine.getShotCamera(camera.id);
            const aspect = project.aspect.split(':').map(Number);
            const filmHeight = 36 / Math.max(aspect[0] / aspect[1], 1);
            const distance = (height * config.focal) / filmHeight;
            const targetPosition = entityPosition(target, this.host.clock).add(
                new THREE.Vector3(0, config.targetHeight, 0),
            );
            const direction = shotCamera.position.clone().sub(targetPosition).normalize();
            camera.position = targetPosition.addScaledVector(direction, distance).toArray() as Vec3;
            camera.path = null;
        }, false);
        if (!applied) return false;
        this.host.patch({ preview: camera.id });
        notifySuccess('已调整机位与焦距；请检查室内墙体遮挡');
        return true;
    }

    updateProjectSettings(patch: { name?: string; aspect?: string; fps?: number }): boolean {
        const name = patch.name?.trim();
        if (patch.name !== undefined && !name) {
            notifyError('项目名称不能为空');
            return false;
        }
        if (patch.aspect !== undefined && !ASPECTS.includes(patch.aspect)) return false;
        if (patch.fps !== undefined && !FRAME_RATES.includes(patch.fps)) return false;
        return this.host.change(() => {
            const project = this.host.project;
            if (name) project.name = name.slice(0, 80);
            if (patch.aspect) project.aspect = patch.aspect;
            if (patch.fps) project.fps = patch.fps;
        });
    }

    updateRoom(patch: Partial<Project['room']>): boolean {
        const next = { ...this.host.project.room, ...patch };
        if (![next.width, next.depth, next.height].every((value) => Number.isFinite(value) && value >= 2.3)) {
            notifyError('房间尺寸至少 2.3 米');
            return false;
        }
        return this.host.change(() => {
            this.host.project.room = next;
        });
    }

    setLightingField(patch: Partial<LightingConfig>): void {
        this.host.change(() => {
            this.host.project.lighting = { ...(this.host.project.lighting ?? defaultLighting()), ...patch };
        });
    }

    setCameraField(patch: Partial<CameraConfig>): void {
        const e = this.host.current();
        if (!e?.camera) return;
        this.host.change(() => {
            e.camera = { ...e.camera!, ...patch };
            if (patch.focal !== undefined && patch.focalKeys === undefined) delete e.camera.focalKeys;
        });
    }

    applyCameraPreset(id: CameraPresetId): boolean {
        const camera = this.host.current();
        const engine = this.host.engine;
        if (!camera?.camera || camera.locked || !engine) return false;
        const from = this.host.clock;
        const duration = 4;
        const liveCamera = engine.getShotCamera(camera.id);
        const start = liveCamera.position.toArray() as Vec3;
        const target = engine.targetPosition(camera).toArray() as Vec3;
        const focal = liveCamera.getFocalLength();
        const motion = cameraPresetPath(id, start, target, from, duration, focal);
        const applied = this.host.change(() => {
            camera.position = [...start];
            camera.path = motion.path;
            camera.camera!.mode = 'free';
            camera.camera!.aim = 'target';
            camera.camera!.targetId = '';
            camera.camera!.target = [...target];
            camera.camera!.targetPath = null;
            camera.camera!.focal = focal;
            if (motion.focalKeys) camera.camera!.focalKeys = motion.focalKeys;
            else delete camera.camera!.focalKeys;
            this.host.project.duration = Math.max(this.host.project.duration, from + duration);
        }, false);
        if (applied) {
            engine.previewId = camera.id;
            this.host.patch({ preview: camera.id, inspectorTab: 'camera' });
        }
        return applied;
    }

    toggleGrid(): void {
        const engine = this.host.engine;
        if (!engine) return;
        engine.gridVisible = !engine.gridVisible;
        engine.refreshHelpers();
        this.host.patch({ gridVisible: engine.gridVisible });
    }

    viewHome(): void {
        this.host.engine?.viewHome();
    }

    viewTop(): void {
        this.host.engine?.viewTop();
    }

    focusSelected(): void {
        const e = this.host.current();
        if (e) this.host.engine?.focus(e.id);
    }
}
