// Ontology stub — pure data, no DOM (mirrors crm_proj src/logic/ rules).
export const ONTOLOGY = {
  entities: ['Field', 'Pipeline', 'Segment', 'Sensor', 'Inspection', 'WorkOrder', 'RiskEvent'],
  relations: [
    ['Field', 'contains', 'Pipeline'],
    ['Pipeline', 'divided-into', 'Segment'],
    ['Segment', 'observed-by', 'Sensor'],
    ['Segment', 'assessed-by', 'Inspection'],
    ['RiskEvent', 'raises', 'WorkOrder'],
    ['WorkOrder', 'targets', 'Segment'],
  ],
};
export const SEGMENTS = [
  { id: 'SEG-01', name: 'North feeder', km: 42, sensors: 18, status: 'ok' },
  { id: 'SEG-02', name: 'River crossing', km: 12, sensors: 26, status: 'ok' },
  { id: 'SEG-03', name: 'Hill section', km: 31, sensors: 21, status: 'watch' },
  { id: 'SEG-04', name: 'Depot link', km: 18, sensors: 14, status: 'ok' },
  { id: 'SEG-05', name: 'South trunk', km: 55, sensors: 30, status: 'alert' },
];
