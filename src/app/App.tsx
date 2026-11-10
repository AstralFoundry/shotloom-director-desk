import { App as AntApp, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { useLanguage } from '@/shared/i18n/use-translation.ts';
import { EditorPage } from './editor/editor-page.tsx';
import { NoticeBridge } from './providers/notice-bridge.tsx';
import { editorTheme } from './providers/theme.ts';

export function App() {
    const language = useLanguage();
    return (
        <ConfigProvider locale={language === 'en' ? enUS : zhCN} theme={editorTheme}>
            <AntApp message={{ maxCount: 3 }}>
                <NoticeBridge />
                <EditorPage />
            </AntApp>
        </ConfigProvider>
    );
}
