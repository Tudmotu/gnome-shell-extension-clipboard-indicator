export const ContentDetectors = [
    {
        type: 'url',
        icon: 'applications-internet-symbolic',
        priority: 100,
        test (text) {
            return /^(https?|ftp|sftp|file):\/\//i.test(text.trim());
        }
    },
    {
        type: 'email',
        icon: 'mail-unread-symbolic',
        priority: 90,
        test (text) {
            return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(text.trim());
        }
    },
    {
        type: 'path',
        icon: 'folder-symbolic',
        priority: 80,
        test (text) {
            return /^\/[a-zA-Z0-9._/-]+$/.test(text.trim());
        }
    },
    {
        type: 'code',
        icon: 'text-x-generic-symbolic',
        priority: 70,
        test (text) {
            if (!text.includes('\n')) return false;
            const patterns = [
                /\b(function|class|def|import|const|let|var)\b/,
                /\b(if|for|while|return|export)\b/,
                /\{[\s\S]*\}/,
            ];
            return patterns.some(p => p.test(text));
        }
    },
];

const DEFAULT_ICON = 'text-x-generic-symbolic';

export function detectContentType (text) {
    if (!text || !text.trim()) return null;

    const sorted = [...ContentDetectors].sort((a, b) => b.priority - a.priority);
    for (const detector of sorted) {
        if (detector.test(text)) {
            return detector;
        }
    }

    return { type: 'text', icon: DEFAULT_ICON, priority: 0 };
}
