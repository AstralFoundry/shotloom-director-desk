import {
    DownloadOutlined,
    FileAddOutlined,
    PictureOutlined,
    QuestionCircleOutlined,
    RedoOutlined,
    SettingOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    UndoOutlined,
} from '@ant-design/icons';
import { Button, Popover, Segmented, Tooltip } from 'antd';
import { useState } from 'react';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { getLanguage, setLanguage } from '@/shared/i18n/locale.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore, type ViewMode } from '@/state/editor-store.ts';
import { useProject, useRevision } from '@/state/use-editor.ts';
import { ExportDialog } from '@/features/export/export-dialog.tsx';
import { HelpPanel } from '@/features/dialogs/help-dialog.tsx';
import { ProjectDialog } from '@/features/dialogs/project-dialog.tsx';
import { NewProjectDialog } from '@/features/dialogs/new-project-dialog.tsx';

const VIEW_MODES: ViewMode[] = ['stage', 'split', 'shot'];

export function TopBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
    const t = useTranslation();
    const [exportOpen, setExportOpen] = useState(false);
    const [projectOpen, setProjectOpen] = useState(false);
    const [newProjectOpen, setNewProjectOpen] = useState(false);
    const project = useProject();
    const view = useEditorStore((state) => state.view);
    const status = useEditorStore((state) => state.status);
    const dirty = useEditorStore((state) => state.dirty);

    useRevision();
    const canUndo = session.history.undoStack.length > 0;
    const canRedo = session.history.redoStack.length > 0;

    const labels: Record<ViewMode, string> = {
        stage: t('导演视角'),
        split: t('分屏'),
        shot: t('机位视角'),
    };

    return (
        <header className="topbar">
            <Button
                className="topbar__scene-toggle"
                type="default"
                icon={sidebarOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
                aria-expanded={sidebarOpen}
                aria-label={sidebarOpen ? t('收起场景面板') : t('展开场景面板')}
                onClick={onToggleSidebar}
            >
                {t('场景')}
            </Button>
            <div className="topbar__brand">
                <span className="topbar__logo">D</span>
                <div className="topbar__title">
                    <strong>{t('导演台')}</strong>
                    <small title={project.name}>{project.name}</small>
                </div>
            </div>

            <Segmented<ViewMode>
                value={view}
                onChange={(value) => session.setView(value)}
                options={VIEW_MODES.map((mode) => ({ value: mode, label: labels[mode] }))}
            />

            <div className="topbar__actions">
                <span className={`save-status ${dirty ? 'save-status--dirty' : ''}`}>
                    <i className="save-status__dot" />
                    {status || t('自动保存')}
                </span>
                <Tooltip title={t('撤销 Ctrl+Z')}>
                    <Button
                        type="text"
                        size="small"
                        icon={<UndoOutlined />}
                        aria-label={t('撤销')}
                        disabled={!canUndo}
                        onClick={() => session.undo()}
                    />
                </Tooltip>
                <Tooltip title={t('重做 Ctrl+Shift+Z')}>
                    <Button
                        type="text"
                        size="small"
                        icon={<RedoOutlined />}
                        aria-label={t('重做')}
                        disabled={!canRedo}
                        onClick={() => session.redo()}
                    />
                </Tooltip>
                <span className="topbar__divider" />
                <Button size="small" icon={<PictureOutlined />} onClick={() => void session.snapshot()}>
                    {t('导出图片')}
                </Button>
                <Button size="small" type="primary" icon={<DownloadOutlined />} onClick={() => setExportOpen(true)}>
                    {t('导出运镜视频')}
                </Button>
                {exportOpen ? <ExportDialog open onClose={() => setExportOpen(false)} /> : null}
                <Tooltip title={t('新建工程')}>
                    <Button
                        type="text"
                        size="small"
                        icon={<FileAddOutlined />}
                        aria-label={t('新建工程')}
                        onClick={() => setNewProjectOpen(true)}
                    />
                </Tooltip>
                <Tooltip title={t('项目设置')}>
                    <Button
                        type="text"
                        size="small"
                        icon={<SettingOutlined />}
                        aria-label={t('项目设置')}
                        onClick={() => setProjectOpen(true)}
                    />
                </Tooltip>
                <Popover
                    content={<HelpPanel />}
                    trigger="click"
                    placement="bottomRight"
                    overlayClassName="help-popover"
                >
                    <Button type="text" size="small" icon={<QuestionCircleOutlined />} aria-label={t('操作与快捷键')} />
                </Popover>
                <Button
                    type="text"
                    size="small"
                    onClick={() => setLanguage(getLanguage() === 'en' ? 'zh-CN' : 'en')}
                    title={t('切换界面语言')}
                >
                    {getLanguage() === 'en' ? '中' : 'EN'}
                </Button>
                {newProjectOpen ? <NewProjectDialog open onClose={() => setNewProjectOpen(false)} /> : null}
                {projectOpen ? <ProjectDialog open onClose={() => setProjectOpen(false)} /> : null}
            </div>
        </header>
    );
}
