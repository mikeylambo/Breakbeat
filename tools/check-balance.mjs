import {execFileSync} from 'node:child_process';
const data=JSON.parse(execFileSync(process.execPath,['tools/balance-report.mjs','24','42'],{encoding:'utf8'}));
const {novice,intermediate,expert}=data.policies;
const ok=intermediate.meanScore>novice.meanScore*3 && expert.meanScore>intermediate.meanScore*1.6 && expert.meanMaxGroupsPass>=3;
if(!ok){console.error('FAIL SKILL_GRADIENT',JSON.stringify(data.policies));process.exit(1);}
console.log(`PASS SKILL_GRADIENT — 24 seeds; novice ${novice.meanScore}, intermediate ${intermediate.meanScore}, expert ${expert.meanScore}; scripted policies, NOT human playtests`);
