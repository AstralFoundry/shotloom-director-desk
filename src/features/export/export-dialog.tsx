import './export-dialog.css';
import { Button, Col, Input, Modal, Progress, Row, Select } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FRAME_RATES, outputSize, type Project } from '@/core/model.ts';
import { exportVideo } from '@/core/export.ts';
import { estimatedVideoBytes, jobFrames, planVideoExports, type ExportJob } from '@/core/exporting/plan.ts';
import { readExportPreferences, saveExportPreferences } from '@/core/exporting/preferences.ts';
import { exportErrorMessage } from '@/core/exporting/errors.ts';
import { download } from '@/core/storage.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { NumberField } from '@/shared/ui/number-field.tsx';
import { notify, notifyError, notifySuccess } from '@/shared/ui/feedback.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { useProject } from '@/state/use-editor.ts';

type SaveMode = 'download' | 'disk';
type VideoFormat = 'mp4' | 'webm';

interface ExportForm {
    filename: string;
    cameraId: string;
    start: number;
    end: number;
    size: '1920' | '1280' | '640';
    fps: 'scene' | string;
    format: VideoFormat;
    monochrome: boolean;
    save: SaveMode;
}

interface FilePickerWindow {
    showSaveFilePicker?: (options: {
        suggestedName: string;
        types: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<FileSystemFileHandle>;
}

const diskSaveSupported = () => typeof (window as unknown as FilePickerWindow).showSaveFilePicker === 'function';

const SCENE_ID = 'current';

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const t = useTranslation();
    const project = useProject();
    const time = useEditorStore((state) => state.time);
    const preview = useEditorStore((state) => state.preview);
    const [form, setForm] = useState<ExportForm>(() => {
        const preferences = readExportPreferences();
        return {
            filename: project.name,
            cameraId: preview,
            start: 0,
            end: project.duration,
            size: preferences.size as ExportForm['size'],
            fps: preferences.fps,
            format: preferences.format as VideoFormat,
            monochrome: false,
            save: diskSaveSupported() ? 'disk' : 'download',
        };
    });
    const [previewImage, setPreviewImage] = useState('');
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const abortRef = useRef<AbortController | null>(null);

    const update = (patch: Partial<ExportForm>) => setForm((current) => ({ ...current, ...patch }));

    const cameras = project.entities.filter((entity) => entity.kind === 'camera');
    const plan = useMemo(() => {
        try {
            const scene = {
                id: SCENE_ID,
                name: project.name,
                duration: project.duration,
                fps: project.fps,
                aspect: project.aspect as Project['aspect'],
            };
            const jobs = planVideoExports(
                [scene],
                [{ sceneId: SCENE_ID, filename: form.filename }],
                {
                    size: Number(form.size),
                    fps: form.fps === 'scene' ? 'scene' : Number(form.fps),
                    format: form.format,
                    monochrome: form.monochrome,
                },
                { start: form.start, end: form.end, cameraId: form.cameraId },
            );
            return { job: jobs[0] as ExportJob, error: '' };
        } catch (error) {
            return { job: undefined, error: (error as Error).message };
        }
    }, [project, form]);

    // Live camera preview for the current export settings (serialized: one render at a time).
    const jobKey = plan.job
        ? JSON.stringify([
              plan.job.options.cameraId,
              plan.job.options.monochrome,
              plan.job.options.start,
              plan.job.options.end,
              plan.job.options.fps,
              project.aspect,
          ])
        : '';
    useEffect(() => {
        if (!open || !plan.job || exporting) return;
        const engine = session.engineOrNull;
        if (!engine) return;
        let cancelled = false;
        const options = plan.job.options;
        const sample = Math.max(options.start, Math.min(time, options.end - 1 / options.fps));
        const oldTime = engine.time;
        const oldMono = engine.monochrome;
        engine.exporting = true;
        void (async () => {
            try {
                const [width, height] = outputSize(project.aspect, 640);
                engine.monochrome = options.monochrome;
                await engine.prepareOutput(sample);
                const canvas = engine.renderOutput(sample, width, height, options.cameraId);
                if (!cancelled) setPreviewImage(canvas.toDataURL('image/png'));
            } catch {
                if (!cancelled) setPreviewImage('');
            } finally {
                engine.monochrome = oldMono;
                engine.restorePreview(oldTime);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, jobKey, exporting, plan.job, project.aspect, time]);

    const summary = plan.job
        ? {
              frames: jobFrames(plan.job),
              seconds: plan.job.options.end - plan.job.options.start,
              megabytes: estimatedVideoBytes(plan.job) / 1e6,
              filename: plan.job.filename,
          }
        : null;

    async function startExport() {
        const job = plan.job;
        const engine = session.engineOrNull;
        if (!job || !engine || exporting) return;
        setExporting(true);
        setProgress(0);
        session.beginBusy();
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            let handle: FileSystemFileHandle | undefined;
            if (form.save === 'disk') {
                const picker = (window as unknown as FilePickerWindow).showSaveFilePicker;
                if (!picker) throw new Error('当前浏览器不支持另存为，请选择下载');
                handle = await picker({
                    suggestedName: job.filename,
                    types: [
                        {
                            description: form.format === 'mp4' ? 'MP4 视频' : 'WebM 视频',
                            accept: {
                                [form.format === 'mp4' ? 'video/mp4' : 'video/webm']: [
                                    form.format === 'mp4' ? '.mp4' : '.webm',
                                ],
                            },
                        },
                    ],
                });
            }
            saveExportPreferences({ size: form.size, format: form.format, fps: form.fps });
            const blob = await exportVideo(engine, job.options, controller.signal, setProgress, handle);
            if (blob) download(blob, job.filename);
            notifySuccess(t('已导出') + ' ' + job.filename);
            onClose();
        } catch (error) {
            const name = (error as Error).name;
            if (name === 'AbortError') notify(t('已取消导出'));
            else notifyError(exportErrorMessage(error));
        } finally {
            abortRef.current = null;
            setExporting(false);
            session.endBusy();
        }
    }

    const cancel = () => {
        abortRef.current?.abort();
    };

    return (
        <Modal
            open={open}
            title={t('导出运镜视频')}
            width={780}
            mask={{ closable: !exporting }}
            closable={!exporting}
            onCancel={() => {
                if (!exporting) onClose();
            }}
            footer={
                exporting ? (
                    <Button danger onClick={cancel}>
                        {t('取消导出')}
                    </Button>
                ) : (
                    <>
                        <Button onClick={onClose}>{t('取消')}</Button>
                        <Button type="primary" disabled={!plan.job} onClick={() => void startExport()}>
                            {t('导出视频')}
                        </Button>
                    </>
                )
            }
        >
            <div className="export-layout">
                <div className="export-fields">
                    <label className="export-field">
                        <span>{t('文件名')}</span>
                        <Input
                            value={form.filename}
                            maxLength={100}
                            aria-label={t('文件名')}
                            disabled={exporting}
                            onChange={(event) => update({ filename: event.target.value })}
                        />
                    </label>

                    <label className="export-field">
                        <span>{t('输出内容')}</span>
                        <Select
                            value={form.cameraId}
                            aria-label={t('输出内容')}
                            disabled={exporting}
                            onChange={(value) => update({ cameraId: value })}
                            options={[
                                { value: 'program', label: t('按切镜输出') },
                                ...cameras.map((camera) => ({ value: camera.id, label: camera.name })),
                            ]}
                        />
                    </label>

                    <div className="export-field">
                        <span>{t('范围')}</span>
                        <div className="inline">
                            <Button
                                size="small"
                                disabled={exporting}
                                onClick={() => update({ start: 0, end: project.duration })}
                            >
                                {t('整场')}
                            </Button>
                            <Button
                                size="small"
                                disabled={exporting}
                                onClick={() => update({ start: time, end: Math.min(project.duration, time + 15) })}
                            >
                                {t('从此处起 15 秒')}
                            </Button>
                            <Button
                                size="small"
                                disabled={exporting}
                                onClick={() => update({ start: time, end: Math.min(project.duration, time + 30) })}
                            >
                                {t('30 秒')}
                            </Button>
                        </div>
                    </div>

                    <Row gutter={8}>
                        <Col span={12}>
                            <label className="export-field">
                                <span>{t('开始 / 秒')}</span>
                                <NumberField
                                    value={form.start}
                                    aria-label={t('开始 / 秒')}
                                    min={0}
                                    step={0.1}
                                    precision={2}
                                    onCommit={(value) => update({ start: value })}
                                />
                            </label>
                        </Col>
                        <Col span={12}>
                            <label className="export-field">
                                <span>{t('结束 / 秒')}</span>
                                <NumberField
                                    value={form.end}
                                    aria-label={t('结束 / 秒')}
                                    min={0.1}
                                    step={0.1}
                                    precision={2}
                                    onCommit={(value) => update({ end: value })}
                                />
                            </label>
                        </Col>
                    </Row>

                    <Row gutter={8}>
                        <Col span={12}>
                            <label className="export-field">
                                <span>{t('分辨率')}</span>
                                <Select
                                    value={form.size}
                                    aria-label={t('分辨率')}
                                    disabled={exporting}
                                    onChange={(value) => update({ size: value })}
                                    options={[
                                        { value: '1920', label: t('1080p 级') },
                                        { value: '1280', label: t('720p 级') },
                                        { value: '640', label: t('360p 级') },
                                    ]}
                                />
                            </label>
                        </Col>
                        <Col span={12}>
                            <label className="export-field">
                                <span>{t('帧率')}</span>
                                <Select
                                    value={form.fps}
                                    aria-label={t('帧率')}
                                    disabled={exporting}
                                    onChange={(value) => update({ fps: value })}
                                    options={[
                                        { value: 'scene', label: t('沿用当前场景') },
                                        ...FRAME_RATES.map((rate) => ({
                                            value: String(rate),
                                            label: `${rate} fps`,
                                        })),
                                    ]}
                                />
                            </label>
                        </Col>
                    </Row>

                    <Row gutter={8}>
                        <Col span={12}>
                            <label className="export-field">
                                <span>{t('视频格式')}</span>
                                <Select
                                    value={form.format}
                                    aria-label={t('视频格式')}
                                    disabled={exporting}
                                    onChange={(value) => update({ format: value })}
                                    options={[
                                        { value: 'mp4', label: 'MP4 / H.264' },
                                        { value: 'webm', label: 'WebM / VP9' },
                                    ]}
                                />
                            </label>
                        </Col>
                        <Col span={12}>
                            <label className="export-field">
                                <span>{t('画面')}</span>
                                <Select
                                    value={form.monochrome ? 'white' : 'color'}
                                    aria-label={t('画面')}
                                    disabled={exporting}
                                    onChange={(value) => update({ monochrome: value === 'white' })}
                                    options={[
                                        { value: 'color', label: t('角色区分色') },
                                        { value: 'white', label: t('统一白模色') },
                                    ]}
                                />
                            </label>
                        </Col>
                    </Row>

                    <label className="export-field">
                        <span>{t('保存到')}</span>
                        <Select
                            value={form.save}
                            aria-label={t('保存到')}
                            disabled={exporting}
                            onChange={(value) => update({ save: value })}
                            options={[
                                ...(diskSaveSupported() ? [{ value: 'disk', label: t('另存为') }] : []),
                                { value: 'download', label: t('下载') },
                            ]}
                        />
                    </label>

                    {plan.error ? <p className="export-error">{plan.error}</p> : null}
                </div>

                <div className="export-preview">
                    <span className="muted small">
                        {t('当前画面')} ·{' '}
                        {form.cameraId === 'program'
                            ? t('按切镜输出')
                            : (cameras.find((camera) => camera.id === form.cameraId)?.name ?? t('按切镜输出'))}
                    </span>
                    {previewImage ? (
                        <img src={previewImage} alt={t('当前画面')} />
                    ) : (
                        <div className="export-preview__placeholder">{t('预览准备中')}</div>
                    )}
                    {summary ? (
                        <div className="export-summary">
                            <strong>
                                {summary.frames} {t('帧')} · {summary.seconds.toFixed(2)} {t('秒')}
                            </strong>
                            <span>
                                {plan.job!.options.width} × {plan.job!.options.height} · {plan.job!.options.fps} fps
                            </span>
                            <span>
                                {t('约')} {summary.megabytes.toFixed(1)} MB
                            </span>
                            <span className="export-filename">{summary.filename}</span>
                        </div>
                    ) : null}
                    {exporting ? (
                        <div className="export-progress">
                            <Progress percent={Math.round(progress * 100)} size="small" />
                            <span className="muted small">{t('正在渲染视频帧…')}</span>
                        </div>
                    ) : null}
                </div>
            </div>
        </Modal>
    );
}
