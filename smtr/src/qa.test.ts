import {describe,expect,it} from 'vitest';
import {statusNeedsDetail} from './QaPage';
import {roleModules} from './permissions';

type QaItem=Parameters<typeof statusNeedsDetail>[0];
const sample=(overrides:Partial<QaItem>={}):QaItem=>({
  id:'1',templateKey:'agent-receive',role:'agent',module:'Transferts',
  scenario:'Réception Central → Agent',testData:'IMEI fictif de recette',
  expectedResult:'Réception validée seulement après contrôle',obtainedResult:'',
  status:'todo',bugRef:'',evidenceUrl:'',branchPr:'',commitSha:'',
  environment:'',nextAction:'',accountRef:'',executionTool:'playwright',
  ...overrides,
});

describe('Cockpit de validation SMTR',()=>{
  it('rend le suivi QA visible pour les quatre profils',()=>{
    for(const role of ['admin','director','manager','agent'] as const)
      expect(roleModules(role)).toContain('qa');
    expect(roleModules('admin')).not.toContain('sales');
    expect(roleModules('agent')).not.toContain('system_audit');
  });
  it('exige résultat, preuve et environnement pour être prêt',()=>{
    expect(statusNeedsDetail(sample(),'ready','agent')).toBe(true);
    expect(statusNeedsDetail(sample({obtainedResult:'Conforme'}),'ready','agent')).toBe(true);
    expect(statusNeedsDetail(sample({
      obtainedResult:'Conforme',evidenceUrl:'https://example.test/capture.png',
      environment:'dev',
    }),'ready','agent')).toBe(false);
  });
  it('ne laisse pas le Manager valider, même avec une preuve',()=>{
    const prepared=sample({
      status:'ready',obtainedResult:'Conforme',environment:'dev',
      evidenceUrl:'https://example.test/report',
    });
    expect(statusNeedsDetail(prepared,'validated','manager')).toBe(true);
    expect(statusNeedsDetail(prepared,'validated','director')).toBe(false);
    expect(statusNeedsDetail({...prepared,status:'todo'},'validated','director')).toBe(true);
  });
  it('exige un bug ou une prochaine action sur les blocages',()=>{
    expect(statusNeedsDetail(sample(),'blocked','agent')).toBe(true);
    expect(statusNeedsDetail(sample({bugRef:'BUG-REF'}),'blocked','agent')).toBe(false);
    expect(statusNeedsDetail(sample({nextAction:'Corriger le cas'}),'failed','agent')).toBe(false);
  });
});
