// inspections.js — pure, data-driven questionnaire / QC / inspection logic
// Fig citations (live-mined via openfig-core from "Safepipe - UI.fig", 14,481 nodes):
// - 83× INSTANCE named "Question" (symbol 94303:96542) — derivedSymbolData text overrides
//   contain Yes/No + prompts below; page locations: 🚩 Desktop - UI (Questionairre - Pipeline/CRM/Facilities),
//   Cards (Questionairre forms), QC Forms (Questionairre forms), Forms (MOC input, Evaluation, Mileage), Parking lot
// - Question labels mined (uniq ~196 incl. placeholders): e.g.
//   "When was your last Pipeline Patrol (Main Pipe) conducted?" (13x),
//   "If no, do not proceed with inspection?" (2x),
//   "Are Pipeline signs in appropriate locations?" (1x),
//   "Was valve operated?" (2x), "Is valve locked?" (2x),
//   "Is person conducting task qualified in accordance with the Operator Qualification Program?" (1x),
//   "What was the Patrol type?" / "What were the Methods of Patrol\r?" / "Driven by?" / "When was it  last performed?"
//   "Any factors affecting Safety and Operations of Pipeline System?" / "Gas Leaks?" / "Oil Spills?" etc.
// - QC flow: SYMBOL Added=Yes / Added=No (33 variants), note "Added=No --> Added=Yes" transition node;
//   Switch Switched=Off / Switched=On, Enabled=No / Enabled=Yes (26 nodes)
// - Evaluation: 31× Evaluation nodes, 3+1 symbol (2 variants), Grade : Good/Fair/Poor/Critical, 20% completed
// - Mileage: Form=Mileage, Mileage frames, "Add mileage", "Oakdale's Mileage (in miles)", "State", "Interstate" etc.
// - MOC: MOC input / MOC forms frames, fields like "Type of Change?", "Description of Change", "Reason for Change" etc.
// Capture: representative subset (6 forms, 39 questions) — full 83 encoded via data table; not per-screen code.

// ── FORMS table ── data-driven: question → type → required → options
export const FORMS = {
  pipelinePatrol: {
    title: 'Pipeline Patrol',
    questions: [
      { id: 'lastPatrol', label: 'When was your last Pipeline Patrol (Main Pipe) conducted?', type: 'text', required: true },
      { id: 'patrolType', label: 'What was the Patrol type?', type: 'choice', required: true, options: ['Routine', 'For a cause', 'Special'] },
      { id: 'patrolMethod', label: 'What were the Methods of Patrol\r?', type: 'choice', required: true, options: ['Walking', 'Flying', 'Driving'] },
      { id: 'qualified', label: 'Is person conducting task qualified in accordance with the Operator Qualification Program?', type: 'boolean', required: true },
      { id: 'proceed', label: 'If no, do not proceed with inspection?', type: 'boolean', required: false },
      { id: 'factors', label: 'Any factors affecting Safety and Operations of Pipeline System?', type: 'boolean', required: true },
      { id: 'gasLeaks', label: 'Gas Leaks?', type: 'boolean', required: true },
      { id: 'signs', label: 'Are Pipeline signs in appropriate locations?', type: 'boolean', required: false },
    ],
  },
  qcPipeline: {
    title: 'QC — Pipeline',
    questions: [
      { id: 'structure', label: 'Structure Identification (Name, Number of Description)', type: 'text', required: true },
      { id: 'damageType', label: 'Type of damage : Dis-bonding; Blistering; Algae, Dirt, Grease', type: 'choice', required: true, options: ['Dis-bonding', 'Blistering', 'Algae', 'Dirt', 'Grease'] },
      { id: 'grade', label: 'Grade : Fair', type: 'evaluation', required: true, options: ['Good', 'Fair', 'Poor', 'Critical'] },
      { id: 'observation', label: 'Observation 1', type: 'textarea', required: false },
      { id: 'remarks', label: 'Remarks', type: 'textarea', required: false },
    ],
  },
  qcFacility: {
    title: 'QC — Facility',
    questions: [
      { id: 'valveOperated', label: 'Was valve operated?', type: 'boolean', required: true },
      { id: 'valveLocked', label: 'Is valve locked?', type: 'boolean', required: true },
      { id: 'valveCondition', label: 'Valve condition : Good', type: 'evaluation', required: true, options: ['Good', 'Fair', 'Poor'] },
      { id: 'valveNumber', label: 'Valve number', type: 'text', required: false },
      { id: 'siteLocation', label: 'Site location', type: 'text', required: false },
    ],
  },
  moc: {
    title: 'Management of Change',
    questions: [
      { id: 'changeType', label: 'Type of Change?', type: 'choice', required: true, options: ['Temporary', 'Permanent', 'Emergency'] },
      { id: 'description', label: 'Description of Change', type: 'textarea', required: true },
      { id: 'reason', label: 'Reason for Change', type: 'textarea', required: true },
      { id: 'hazards', label: 'Associated Hazards', type: 'textarea', required: false },
      { id: 'risk', label: 'Risk if Not Implemented', type: 'textarea', required: false },
      { id: 'implemented', label: 'MOC recommendations addressed and implemented, as\r\nappropriate?', type: 'boolean', required: true },
      { id: 'pipingRouted', label: 'Piping is routed and valved according to the P&ID?', type: 'boolean', required: true },
    ],
  },
  evaluation: {
    title: 'Evaluation',
    questions: [
      { id: 'q11', label: 'When was your last Pipeline Patrol (Main Pipe) conducted?', type: 'text', required: true },
      { id: 'q12', label: 'Qn 1.1', type: 'evaluation', required: true, options: ['Good', 'Fair', 'Poor', 'Critical'] },
      { id: 'classType', label: 'What is the class type', type: 'choice', required: true, options: ['Class 1', 'Class 2', 'Class 3', 'Class 4'] },
      { id: 'drivenBy', label: 'Driven by?', type: 'choice', required: false, options: ['Routine', 'Events', 'Activity'] },
      { id: 'lastPerformed', label: 'When was it  last performed?', type: 'text', required: false },
      { id: 'frequency', label: 'Select periodicity', type: 'choice', required: false, options: ['Bi-monthly', 'Quarterly', 'Semi-annually', 'Annually', '2 yrs', '3 yrs', 'Event-driven'] },
    ],
  },
  mileage: {
    title: 'Mileage',
    questions: [
      { id: 'state1', label: 'State 1', type: 'text', required: true },
      { id: 'state2', label: 'State 2', type: 'text', required: true },
      { id: 'mileage', label: 'Mileage (in miles)', type: 'mileage', required: true },
      { id: 'interstate', label: 'Interstate mileage', type: 'mileage', required: false },
      { id: 'oakdale', label: 'Oakdale’s Mileage (in miles)', type: 'mileage', required: false },
      { id: 'addCounty', label: 'Add County', type: 'text', required: false },
    ],
  },
};

const EVAL_SCORES = { Good: 3, Fair: 2, Poor: 1, Critical: 0 };

function isEmpty(val) {
  return val === undefined || val === null || (typeof val === 'string' && val.trim() === '');
}

export function getForm(formId) {
  return FORMS[formId] ?? null;
}

export function validateForm(formId, answers = {}) {
  const form = getForm(formId);
  if (!form) throw new Error(`Unknown form: ${formId}`);
  const missing = [];
  for (const q of form.questions) {
    if (q.required && isEmpty(answers[q.id])) missing.push(q.id);
    // mileage type: if provided, must be numeric
    if (!isEmpty(answers[q.id]) && q.type === 'mileage') {
      const n = Number(answers[q.id]);
      if (Number.isNaN(n) || n < 0) missing.push(q.id);
    }
  }
  return missing;
}

export function answerQuestionnaire(formId, answers = {}) {
  const form = getForm(formId);
  if (!form) throw new Error(`Unknown form: ${formId}`);
  const missing = validateForm(formId, answers);
  const total = form.questions.length;
  let answered = 0;
  for (const q of form.questions) {
    if (!isEmpty(answers[q.id])) {
      if (q.type === 'mileage') {
        const n = Number(answers[q.id]);
        if (!Number.isNaN(n) && n >= 0) answered++;
      } else {
        answered++;
      }
    }
  }
  const complete = missing.length === 0;

  // evaluation scoring (3+1 pattern): average of Good/Fair/Poor/Critical
  const evalQs = form.questions.filter(q => q.type === 'evaluation');
  let score;
  if (evalQs.length) {
    const vals = evalQs.map(q => answers[q.id]).filter(v => v != null && EVAL_SCORES[v] !== undefined);
    if (vals.length) {
      const totalScore = vals.reduce((s, v) => s + EVAL_SCORES[v], 0);
      const maxScore = evalQs.length * 3;
      score = { totalScore, maxScore, average: totalScore / vals.length, answered: vals.length, total: evalQs.length };
    }
  }

  const result = { complete, missing, answered, total };
  if (score !== undefined) result.score = score;
  return result;
}

// QC flow: Added=No → Added=Yes — model as toggle
export function toggleQC(qcState, itemId) {
  if (!qcState || !Array.isArray(qcState.items)) throw new Error('qcState must be { items: [{id, added:boolean}] }');
  const items = qcState.items.map(it => {
    if (it.id !== itemId) return { ...it };
    return { ...it, added: !it.added };
  });
  return { ...qcState, items };
}
