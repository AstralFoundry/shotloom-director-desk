import type { ThemeConfig } from 'antd';
import { theme } from 'antd';

/**
 * Dark stage palette modelled on the reference director desk: pure black canvas,
 * #1a1a1a panels, translucent hairlines, 10–12px radii and charcoal button states.
 */
export const editorTheme: ThemeConfig = {
    algorithm: theme.darkAlgorithm,
    token: {
        colorPrimary: '#fafafa',
        colorTextLightSolid: '#0a0a0a',
        colorBgBase: '#000000',
        colorBgContainer: '#171717',
        colorBgElevated: '#242424',
        colorBgLayout: '#050505',
        colorBorder: 'rgba(255, 255, 255, 0.14)',
        colorBorderSecondary: 'rgba(255, 255, 255, 0.08)',
        colorText: '#ededed',
        colorTextSecondary: 'rgba(255, 255, 255, 0.6)',
        colorTextTertiary: 'rgba(255, 255, 255, 0.42)',
        borderRadius: 8,
        borderRadiusLG: 10,
        borderRadiusSM: 6,
        controlHeight: 34,
        controlHeightSM: 30,
        controlHeightLG: 38,
        controlPaddingHorizontal: 11,
        controlPaddingHorizontalSM: 9,
        fontSize: 13,
        fontFamily: "'Inter Variable', Inter, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
        boxShadowSecondary: '0 18px 44px rgba(0, 0, 0, 0.55)',
        motionDurationMid: '0.14s',
    },
    components: {
        Button: {
            colorPrimary: '#303030',
            colorPrimaryHover: '#3c3c3c',
            colorPrimaryActive: '#282828',
            primaryColor: '#f4f4f4',
            defaultBg: '#202020',
            defaultBorderColor: 'rgba(255, 255, 255, 0.14)',
            defaultColor: '#ededed',
            defaultHoverBg: '#292929',
            defaultHoverBorderColor: 'rgba(255, 255, 255, 0.22)',
            primaryShadow: 'none',
            defaultShadow: 'none',
            fontWeight: 500,
        },
        Tabs: {
            itemColor: 'rgba(250, 250, 250, 0.5)',
            itemSelectedColor: '#fafafa',
            inkBarColor: '#fafafa',
            horizontalItemGutter: 12,
            horizontalItemPadding: '9px 0',
            titleFontSize: 13,
        },
        Segmented: {
            trackBg: '#1b1b1b',
            itemSelectedBg: '#303030',
            itemColor: 'rgba(255, 255, 255, 0.6)',
            itemSelectedColor: '#f4f4f4',
            itemHoverColor: '#f4f4f4',
            trackPadding: 3,
        },
        Input: {
            activeBorderColor: '#8b8aff',
            hoverBorderColor: 'rgba(255, 255, 255, 0.26)',
            activeShadow: 'none',
            paddingInline: 9,
        },
        InputNumber: {
            activeBorderColor: '#8b8aff',
            hoverBorderColor: 'rgba(255, 255, 255, 0.26)',
            activeShadow: 'none',
            paddingInline: 9,
        },
        Select: {
            optionSelectedBg: '#343434',
            optionActiveBg: '#2c2c2c',
        },
        Modal: {
            contentBg: '#1a1a1a',
            headerBg: 'transparent',
            titleFontSize: 16,
            borderRadiusLG: 14,
        },
        Tooltip: {
            colorBgSpotlight: '#2a2a2a',
            colorTextLightSolid: '#fafafa',
        },
        Menu: {
            itemBg: 'transparent',
            itemSelectedBg: '#2a2a2a',
            itemHoverBg: 'rgba(255, 255, 255, 0.06)',
            itemBorderRadius: 8,
        },
        Empty: {
            colorTextDescription: 'rgba(250, 250, 250, 0.4)',
        },
        Alert: {
            borderRadiusLG: 10,
        },
    },
};
