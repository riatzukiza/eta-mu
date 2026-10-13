// SPDX-License-Identifier: GPL-3.0-or-later
// PRIVATE canonical-Muse control harness. Review scaffold and perturbations are
// synthetic; selected HOST read event bytes come from the actual pinned client.
// No provider approval, real full review, caller authentication or understanding.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const q=path.dirname(fileURLToPath(import.meta.url)); // Archived evidence, no model or tool execution.
const modulePath=process.env.MUSE_REVIEW_INVOCATION_MODULE||'/home/err/spaces/cephalon-muse-context-custody/muse/.opencode/dist/review-invocation.cjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(sha(fs.readFileSync(modulePath)),'46bb6ac957cd23a7d66789c9bb6ce26eed71a1b808abfc5887e98d4c0e9de3b6');
const v=createRequire(import.meta.url)(modulePath);
const raw=fs.readFileSync(path.join(q,'genuine-host-read.stdout.jsonl'));
assert.equal(raw.length,166859,'custody: native HOST trace byte count');
assert.equal(sha(raw),'f866932ebcc2c86ad65cab59434a061b0271986bec40d936574ab184f01d4df0','custody: native HOST trace SHA256');
const manifestBytes=fs.readFileSync(path.join(q,'prepared-probe-inputs.json'));
assert.equal(sha(manifestBytes),'115da5136a69112e421ca541019a96a4a779152ec6fb71d708a8d98f2f32067b','custody: prepared fixture manifest SHA256');
const archive=JSON.parse(manifestBytes.toString('utf8'));
const fixtures=new Map();
for(const recorded of archive.fixtures){
 const name=path.basename(recorded.path);
 assert.ok(!fixtures.has(name),'custody: duplicate fixture basename');
 const bytes=fs.readFileSync(path.join(q,'fixture',name));
 assert.equal(bytes.length,recorded.bytes,'custody: fixture '+name+' byte count');
 assert.equal(sha(bytes),recorded.sha256,'custody: fixture '+name+' SHA256');
 fixtures.set(name,{...recorded,bytes});
}
const events=raw.toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const reads=events.filter(e=>e.type==='tool_use'&&e.part?.tool==='read'&&e.part?.state?.status==='completed');
assert.ok(reads.length>=5,'Actual native completed read events required');
// One fresh owned output directory per replay; archived evidence is never a destination.
const outputDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'cephalon-host-frame-replay-'));
const tools=['review_begin','review_read_diff_chunk','review_assess_diff_chunk','review_record_evidence','review_propose_finding','review_classify_finding','review_status','review_submit'];
const stages=['deterministic','map-change','generate-candidates','adversarial-validate','publish'];
const full=Buffer.from('diff --git a/fixture.txt b/fixture.txt\n--- a/fixture.txt\n+++ b/fixture.txt\n@@ -1 +1 @@\n-old\n+new ημ\n');
const source={schema:'open-hax.review-input/v1',base_sha:'a'.repeat(40),head_sha:'b'.repeat(40),diff_base_sha:'a'.repeat(40),full_diff:{path:'basehead.diff',bytes:full.length,sha256:sha(full)},provenance:{repository:'synthetic/host-frame-control',pull_request:'1',run_id:'2',run_attempt:'1',workflow_sha:'d'.repeat(40),workflow_ref:'synthetic/host-frame-control/workflow@refs/pull/1/merge'}};
const results=[];
function control(name,file,selected,change){
 const fixture=fixtures.get(path.basename(file));
 const contextBytes=fixture.bytes,submissionFile=path.join(outputDirectory,name+'-synthetic-submission.json');
 const expectedNativePath=fixture.path;
 const ctx=v.prepareReviewInvocationContext(full,Buffer.from(JSON.stringify(source)),tools,submissionFile,contextBytes,expectedNativePath);
 const native=structuredClone(selected);if(change)change(native);
 const sid=selected[0]?.sessionID||'synthetic-empty-omission';
 const lastHostEnd=Math.max(1,...selected.map(e=>e.part.state.time.end));let clock=Math.max(1,Math.min(...selected.map(e=>e.part.state.time.start))-1);const trace=[];
 function call(tool,input,output){const n=trace.length+1;trace.push({type:'tool_use',timestamp:clock,sessionID:sid,part:{type:'tool',id:'synthetic-part-'+n,callID:'synthetic-call-'+n,sessionID:sid,tool,state:{status:'completed',input,time:{start:clock,end:clock},output:JSON.stringify({...output,'context-protocol':'open-hax.review-context/v1','context-source':ctx.contextSource,'context-observation':{status:'present',source:ctx.contextSource}})}}});clock++;}
 // The qualified Muse wire key diff-stats.bytes is UTF-16 page geometry.
 // source.full_diff.bytes binds actual UTF-8 bytes; keep their units separate.
 call('review_begin',{}, {'ok?':true,stage:stages[0],stages,'input-source':ctx.inputSource,'diff-stats':{files:1,bytes:full.toString('utf8').length,'truncated?':false},'input-coverage':{chunks:ctx.pages.length,delivered:0,assessed:0,missing:ctx.pages.map(p=>p.id)}});
 trace.push(...native);clock=Math.max(lastHostEnd,...selected.map(e=>e.timestamp))+1;
 const notes=ctx.pages.map(p=>({...p,note:'Synthetic complete page assessment for HOST framing control, no review judgment.'}));
 for(const [i,p] of ctx.pages.entries()){call('review_read_diff_chunk',{id:p.id},{'ok?':true,chunk:{...p,text:full.toString('utf8').slice(p.start,p.end)}});call('review_assess_diff_chunk',{id:p.id,note:notes[i].note},{'ok?':true,'chunk-id':p.id,coverage:{chunks:ctx.pages.length,delivered:i+1,assessed:i+1,missing:ctx.pages.slice(i+1).map(x=>x.id)}});}
 for(const stage of stages)call('review_record_evidence',{stage,note:'Synthetic '+stage+' control after genuine HOST delivery.'},{'ok?':true});
 const body={schema:'open-hax.github-review/v1',event:'COMMENT',summary:'Synthetic canonical HOST framing control; no review credit.',comments:[],'context-protocol':'open-hax.review-context/v1','context-source':ctx.contextSource,'input-source':ctx.inputSource,'input-coverage':{chunks:ctx.pages.length,delivered:ctx.pages.length,assessed:ctx.pages.length,missing:[]},'input-assessments':notes};
 call('review_submit',{summary:body.summary},{'ok?':true,event:'COMMENT',file:submissionFile,'inline-comments':0});trace.push({type:'step_finish',timestamp:clock,sessionID:sid,part:{type:'step-finish',id:'synthetic-stop',sessionID:sid,reason:'stop'}});
 const response=Buffer.from(trace.map(JSON.stringify).join('\n')+'\n'),submission=Buffer.from(JSON.stringify(body));
 const verdict=v.verifyReviewInvocation(response,submission,ctx);
 fs.writeFileSync(path.join(outputDirectory,name+'-control-response.jsonl'),response,{flag:'wx'});fs.writeFileSync(submissionFile,submission,{flag:'wx'});
 results.push({name,contextSource:ctx.contextSource,actualSelectedReadCount:selected.length,readVariant:change?'synthetic perturbation of genuine HOST events':'unmodified native HOST reads',reviewScaffold:'synthetic, no native approval',verdict,responseSha256:sha(response),submissionSha256:sha(submission)});
 return verdict;
}
const file=n=>path.join(q,'fixture',n+'-context.md');
const selected=f=>{const expected=fixtures.get(path.basename(f)).path;return reads.filter(e=>e.part.state.input.filePath===expected);};
const large=file('large'),empty=file('empty'),clipped=file('clipped');
assert.equal(control('actual-large-complete',large,selected(large)).ok,true);
assert.equal(control('actual-present-empty',empty,selected(empty)).ok,true);
assert.equal(control('actual-clipped-line-refuses',clipped,selected(clipped)).ok,false);
assert.equal(control('synthetic-omitted-read-refuses',large,selected(large),x=>x.splice(0,x.length)).ok,false);
assert.equal(control('synthetic-missing-range-refuses',large,selected(large),x=>x.splice(1,1)).ok,false);
assert.equal(control('synthetic-altered-output-refuses',large,selected(large),x=>x[0].part.state.output+=' synthetic corruption').ok,false);
assert.equal(control('synthetic-late-delivery-refuses',large,selected(large),x=>x[0].part.state.time.end=Number.MAX_SAFE_INTEGER).ok,false);
assert.equal(control('synthetic-missing-eof-refuses',large,selected(large),x=>{
 assert.equal(x.length,3,'EOF-only control retains all three read ranges');
 const last=x.at(-1).part.state;
 assert.match(last.output,/\(End of file - total \d+ lines\)/);
 last.output=last.output.replace(/\(End of file - total \d+ lines\)/,'');
}).ok,false);
assert.equal(control('synthetic-unavailable-read-refuses',large,selected(large),x=>{x[0].part.state.status='error';x[0].part.state.error='Synthetic unavailable read control';}).ok,false);
const report={clientVersion:'1.18.31',modulePath,moduleSha256:sha(fs.readFileSync(modulePath)),nativeResponseSha256:sha(raw),preparedManifestSha256:sha(manifestBytes),fixtureCustody:archive.fixtures,nativeCompletedReads:reads.length,diffEncoding:{utf8Bytes:full.length,utf16CodeUnits:full.toString('utf8').length,legacyDiffStatsBytesUnit:'utf16-code-units'},results,limits:'Structural HOST framing only. Synthetic review state scaffold, no actual provider review, publication, caller integration, authority or understanding claim.'};
const reportPath=path.join(outputDirectory,'replay-canonical-host-framing-control-results.json');
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({controls:results.length,allAssertionsPassed:true,nativeCompletedReads:reads.length,outputDirectory,reportPath,results:results.map(r=>({name:r.name,ok:r.verdict.ok,code:r.verdict.code,coverage:r.verdict.contextReadCoverage}))}));
