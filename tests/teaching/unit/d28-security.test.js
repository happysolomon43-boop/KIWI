'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {sanitizeStructuredContent,validateMaterialUpload,validateSupplementaryMaterialInput,assertTrustedBackendAction,redactOperationalMetadata,assertContextMinimized,protectedAssessmentContentAllowed}=require('../../../teaching/d28/security');
const {extractValidatedMaterial,OFFICE_DECOMPRESSION_LIMITS}=require('../../../teaching/d28/material-upload');
test('structured Board/free-text content rejects executable fields and URI schemes',()=>{assert.throws(()=>sanitizeStructuredContent({html:'<script>x</script>'}),/Unsafe/);assert.throws(()=>sanitizeStructuredContent({link:'javascript:alert(1)'}),/Unsafe/);assert.deepEqual(sanitizeStructuredContent({type:'text',text:'safe'}),{type:'text',text:'safe'});});
test('Teaching material upload validates type extension size and signature',()=>{const pdf=Buffer.from('%PDF-1.7');assert.equal(validateMaterialUpload({filename:'lesson.pdf',mimeType:'application/pdf',sizeBytes:pdf.length,bytes:pdf}).extension,'.pdf');assert.throws(()=>validateMaterialUpload({filename:'lesson.exe',mimeType:'application/pdf',sizeBytes:10,bytes:pdf}),/extension/i);assert.throws(()=>validateMaterialUpload({filename:'lesson.pdf',mimeType:'application/pdf',sizeBytes:99_000_000,bytes:pdf}),/size/i);});
test('Teaching DOCX extraction uses the same bounded officeparser path as PPTX',async()=>{
 const calls=[];
 const officeParser={async parseOffice(bytes,options){calls.push({bytes,options});return {async to(kind,options2){calls.push({kind,options:options2});return {value:'Alpha\r\nBeta\u0000'}}};}};
 const bytes=Buffer.from([0x50,0x4b,0x03,0x04,0x00,0x00]);
 const result=await extractValidatedMaterial({filename:'lesson.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes},{officeParser});
 assert.equal(calls[0].options.fileType,'docx');
 assert.deepEqual(calls[0].options.decompressionLimits,OFFICE_DECOMPRESSION_LIMITS);
 assert.equal(calls[1].kind,'text');
 assert.equal(result.materials[0].content,'Alpha\\nBeta');
});

test('all privileged academic mutations require trusted backend execution',()=>{for(const action of ['GRADE_FINALIZE','ASSESSMENT_PACKAGE_LOCK','COURSE_ACTIVATE','REQUEST_APPROVE','REQUEST_APPLY','PROGRESSION_FINALIZE','ATTENDANCE_CORRECT','GRADING_POLICY_LOCK','ASSESSMENT_TIMER_START','ASSESSMENT_TIMER_EXPIRE'])assert.throws(()=>assertTrustedBackendAction(action,{role:'authenticated'}),/trusted backend/i);assert.equal(assertTrustedBackendAction('GRADE_FINALIZE',{trustedBackend:true}),true);});
test('operational metadata redacts secrets, raw responses and hidden reasoning',()=>{const out=redactOperationalMetadata({token:'x',student_response:'answer',chain_of_thought:'reason',safe:'ok'});assert.equal(out.token,'[REDACTED]');assert.equal(out.student_response,'[REDACTED]');assert.equal(out.chain_of_thought,'[REDACTED]');assert.equal(out.safe,'ok');});
test('context minimization and protected assessment gates fail closed',()=>{assert.throws(()=>assertContextMinimized({allowedClasses:['course'],prohibitedClasses:['attendance'],context:{attendance:{}}}),/Prohibited/);assert.equal(protectedAssessmentContentAllowed({released:false,purpose:'STUDENT_QUERY'}),false);assert.equal(protectedAssessmentContentAllowed({released:false,purpose:'FORMAL_MARKING'}),true);});

test('D07 supplementary source intake rejects binary-like client payloads and enforces extracted-text bounds',()=>{assert.throws(()=>validateSupplementaryMaterialInput({sourceKind:'STUDENT_SUPPLEMENT',sourceRef:'s',filename:'notes.pdf',mimeType:'application/pdf',sizeBytes:100,content:'text'}),error=>error?.code==='TEACHING_D28_SUPPLEMENT_BINARY_UPLOAD_REQUIRES_VALIDATED_BOUNDARY');assert.throws(()=>validateSupplementaryMaterialInput({sourceKind:'STUDENT_SUPPLEMENT',sourceRef:'s',content:'x'.repeat(70_000)}),error=>error?.code==='TEACHING_D28_SUPPLEMENT_TEXT_SIZE_FORBIDDEN');assert.equal(validateSupplementaryMaterialInput({sourceKind:'STUDENT_SUPPLEMENT',sourceRef:'s',content:'safe extracted text'}).content,'safe extracted text');});
