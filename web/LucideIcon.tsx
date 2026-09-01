import React from 'react';

type IconNode = [keyof React.JSX.IntrinsicElements, Record<string, string>];

const ICONS = {
    archiveRestore: [
        ['rect', { width: '20', height: '5', x: '2', y: '3', rx: '1' }],
        ['path', { d: 'M4 8v11a2 2 0 0 0 2 2h2' }],
        ['path', { d: 'M20 8v11a2 2 0 0 1-2 2h-2' }],
        ['path', { d: 'm9 15 3-3 3 3' }],
        ['path', { d: 'M12 12v9' }],
    ],
    bookOpen: [
        ['path', { d: 'M12 7v14' }],
        ['path', { d: 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z' }],
    ],
    bookOpenText: [
        ['path', { d: 'M12 7v14' }],
        ['path', { d: 'M16 12h2' }],
        ['path', { d: 'M16 8h2' }],
        ['path', { d: 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z' }],
        ['path', { d: 'M6 12h2' }],
        ['path', { d: 'M6 8h2' }],
    ],
    check: [['path', { d: 'M20 6 9 17l-5-5' }]],
    chevronLeft: [['path', { d: 'm15 18-6-6 6-6' }]],
    circlePlay: [
        ['path', { d: 'M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z' }],
        ['circle', { cx: '12', cy: '12', r: '10' }],
    ],
    cloudDownload: [
        ['path', { d: 'M12 13v8l-4-4' }],
        ['path', { d: 'm12 21 4-4' }],
        ['path', { d: 'M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284' }],
    ],
    cloudUpload: [
        ['path', { d: 'M12 13v8' }],
        ['path', { d: 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242' }],
        ['path', { d: 'm8 17 4-4 4 4' }],
    ],
    download: [
        ['path', { d: 'M12 15V3' }],
        ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
        ['path', { d: 'm7 10 5 5 5-5' }],
    ],
    ellipsis: [
        ['circle', { cx: '12', cy: '12', r: '1' }],
        ['circle', { cx: '19', cy: '12', r: '1' }],
        ['circle', { cx: '5', cy: '12', r: '1' }],
    ],
    layoutGrid: [
        ['rect', { width: '7', height: '7', x: '3', y: '3', rx: '1' }],
        ['rect', { width: '7', height: '7', x: '14', y: '3', rx: '1' }],
        ['rect', { width: '7', height: '7', x: '14', y: '14', rx: '1' }],
        ['rect', { width: '7', height: '7', x: '3', y: '14', rx: '1' }],
    ],
    list: [
        ['path', { d: 'M3 5h.01' }],
        ['path', { d: 'M3 12h.01' }],
        ['path', { d: 'M3 19h.01' }],
        ['path', { d: 'M8 5h13' }],
        ['path', { d: 'M8 12h13' }],
        ['path', { d: 'M8 19h13' }],
    ],
    listTree: [
        ['path', { d: 'M8 5h13' }],
        ['path', { d: 'M13 12h8' }],
        ['path', { d: 'M13 19h8' }],
        ['path', { d: 'M3 10a2 2 0 0 0 2 2h3' }],
        ['path', { d: 'M3 5v12a2 2 0 0 0 2 2h3' }],
    ],
    messageSquareText: [
        ['path', { d: 'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z' }],
        ['path', { d: 'M7 11h10' }],
        ['path', { d: 'M7 15h6' }],
        ['path', { d: 'M7 7h8' }],
    ],
    notebookPen: [
        ['path', { d: 'M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4' }],
        ['path', { d: 'M2 6h4' }],
        ['path', { d: 'M2 10h4' }],
        ['path', { d: 'M2 14h4' }],
        ['path', { d: 'M2 18h4' }],
        ['path', { d: 'M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z' }],
    ],
    pencil: [
        ['path', { d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z' }],
        ['path', { d: 'm15 5 4 4' }],
    ],
    plus: [
        ['path', { d: 'M5 12h14' }],
        ['path', { d: 'M12 5v14' }],
    ],
    search: [
        ['path', { d: 'm21 21-4.34-4.34' }],
        ['circle', { cx: '11', cy: '11', r: '8' }],
    ],
    settings: [
        ['path', { d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915' }],
        ['circle', { cx: '12', cy: '12', r: '3' }],
    ],
    slidersHorizontal: [
        ['path', { d: 'M10 5H3' }],
        ['path', { d: 'M12 19H3' }],
        ['path', { d: 'M14 3v4' }],
        ['path', { d: 'M16 17v4' }],
        ['path', { d: 'M21 12h-9' }],
        ['path', { d: 'M21 19h-5' }],
        ['path', { d: 'M21 5h-7' }],
        ['path', { d: 'M8 10v4' }],
        ['path', { d: 'M8 12H3' }],
    ],
    star: [['path', { d: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z' }]],
    sunMoon: [
        ['path', { d: 'M12 2v2' }],
        ['path', { d: 'M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715' }],
        ['path', { d: 'M16 12a4 4 0 0 0-4-4' }],
        ['path', { d: 'm19 5-1.256 1.256' }],
        ['path', { d: 'M20 12h2' }],
    ],
    trash2: [
        ['path', { d: 'M10 11v6' }],
        ['path', { d: 'M14 11v6' }],
        ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
        ['path', { d: 'M3 6h18' }],
        ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
    ],
    type: [
        ['path', { d: 'M12 4v16' }],
        ['path', { d: 'M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2' }],
        ['path', { d: 'M9 20h6' }],
    ],
    upload: [
        ['path', { d: 'M12 3v12' }],
        ['path', { d: 'm17 8-5-5-5 5' }],
        ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ],
} satisfies Record<string, IconNode[]>;

export type LucideIconName = keyof typeof ICONS;

export function LucideIcon({
    name,
    size = 18,
    strokeWidth = 2,
    className,
}: {
    name: LucideIconName;
    size?: number;
    strokeWidth?: number;
    className?: string;
}) {
    return (
        <svg
            aria-hidden="true"
            className={className}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {ICONS[name].map(([tag, props], index) => React.createElement(tag, { ...props, key: `${name}-${index}` }))}
        </svg>
    );
}
