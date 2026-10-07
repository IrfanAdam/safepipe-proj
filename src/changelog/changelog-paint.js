// safepipe changelog — paint composer · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
import { paintChips } from './changelog/paint-chips.js';
import { paintPlan } from './changelog/paint-plan.js';
import { paintDetail } from './changelog/paint-detail.js';
export function paint(root, ctx){
  paintChips(root, ctx);
  if (paintPlan(root, ctx)) paintDetail(root, ctx);
}
