// safepipe changelog — attr escaper · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
export const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
