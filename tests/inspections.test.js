import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FORMS, getForm, answerQuestionnaire, toggleQC, validateForm } from '../src/logic/inspections.js';

describe('inspections — shape', () => {
  it('exports 6 forms with questions', () => {
    assert.equal(typeof FORMS, 'object');
    for (const id of ['pipelinePatrol', 'qcPipeline', 'qcFacility', 'moc', 'evaluation', 'mileage']) {
      assert.ok(FORMS[id], `missing ${id}`);
      assert.ok(FORMS[id].title);
      assert.ok(Array.isArray(FORMS[id].questions));
      assert.ok(FORMS[id].questions.length >= 5);
      for (const q of FORMS[id].questions) {
        assert.ok(q.id && q.label && q.type);
        assert.equal(typeof q.required, 'boolean');
      }
    }
  });
  it('getForm returns null for unknown', () => {
    assert.equal(getForm('nope'), null);
    assert.equal(getForm('pipelinePatrol').title, 'Pipeline Patrol');
  });
  it('FORMS covers required types', () => {
    const types = new Set(Object.values(FORMS).flatMap(f => f.questions.map(q => q.type)));
    for (const t of ['boolean', 'text', 'textarea', 'choice', 'evaluation', 'mileage']) assert.ok(types.has(t), `missing type ${t}`);
  });
});

describe('answerQuestionnaire', () => {
  it('complete when all required answered', () => {
    const r = answerQuestionnaire('pipelinePatrol', {
      lastPatrol: '2021-09-10',
      patrolType: 'Routine',
      patrolMethod: 'Walking',
      qualified: true,
      factors: false,
      gasLeaks: false,
    });
    assert.equal(r.complete, true);
    assert.deepEqual(r.missing, []);
    assert.equal(r.answered >= 6, true);
  });

  it('missing required questions', () => {
    const r = answerQuestionnaire('pipelinePatrol', { lastPatrol: '2021-09-10' });
    assert.equal(r.complete, false);
    assert.ok(r.missing.includes('patrolType'));
    assert.ok(r.missing.includes('patrolMethod'));
    assert.ok(r.missing.length >= 3);
  });

  it('optional questions do not block complete', () => {
    const r = answerQuestionnaire('qcPipeline', {
      structure: 'S-1',
      damageType: 'Blistering',
      grade: 'Fair',
    });
    assert.equal(r.complete, true); // observation/remarks optional
  });

  it('validateForm mirrors missing', () => {
    const m = validateForm('moc', { changeType: 'Temporary' });
    assert.ok(m.includes('description'));
    assert.ok(m.includes('reason'));
  });

  it('mileage validates numeric', () => {
    const r1 = answerQuestionnaire('mileage', { state1: 'Texas', state2: 'Louisiana', mileage: '13' });
    assert.equal(r1.complete, true);
    const r2 = answerQuestionnaire('mileage', { state1: 'Texas', state2: 'Louisiana', mileage: 'abc' });
    assert.equal(r2.complete, false);
    assert.ok(r2.missing.includes('mileage'));
  });

  it('evaluation scoring present when answered', () => {
    const r = answerQuestionnaire('qcPipeline', { structure: 'S-1', damageType: 'Dirt', grade: 'Good' });
    assert.ok(r.score);
    assert.equal(r.score.totalScore, 3);
    assert.equal(r.score.maxScore, 3);
    const r2 = answerQuestionnaire('evaluation', {
      q11: '2021-09-10', q12: 'Poor', classType: 'Class 2',
    });
    assert.ok(r2.score);
    assert.equal(r2.score.totalScore, 1);
  });

  it('throws for unknown form', () => {
    assert.throws(() => answerQuestionnaire('nope', {}), /Unknown form/);
  });
});

describe('toggleQC', () => {
  it('toggles Added=No → Added=Yes and back', () => {
    const s0 = { items: [{ id: 'a', added: false }, { id: 'b', added: true }] };
    const s1 = toggleQC(s0, 'a');
    assert.equal(s1.items.find(x => x.id === 'a').added, true);
    assert.equal(s0.items.find(x => x.id === 'a').added, false); // immutable
    const s2 = toggleQC(s1, 'a');
    assert.equal(s2.items.find(x => x.id === 'a').added, false);
  });
  it('leaves other items untouched', () => {
    const s = toggleQC({ items: [{ id: 'x', added: false }] }, 'y');
    assert.equal(s.items[0].added, false);
  });
  it('throws on bad state', () => {
    assert.throws(() => toggleQC(null, 'a'), /qcState/);
  });
});

describe('verbatim-live labels (spot-check)', () => {
  const allLabels = Object.values(FORMS).flatMap(f => f.questions.map(q => q.label));
  const mustExist = [
    'When was your last Pipeline Patrol (Main Pipe) conducted?',
    'Are Pipeline signs in appropriate locations?',
    'Was valve operated?',
    'Is valve locked?',
    'What was the Patrol type?',
    'Type of damage : Dis-bonding; Blistering; Algae, Dirt, Grease',
    'Mileage (in miles)',
  ];
  for (const label of mustExist) {
    it(`label verbatim: ${label.slice(0, 40)}`, () => {
      assert.ok(allLabels.includes(label), `missing verbatim label: ${label}`);
      assert.ok(label.length > 5);
    });
  }
  it('at least 5 non-empty labels', () => {
    assert.ok(allLabels.filter(Boolean).length >= 5);
  });
});
