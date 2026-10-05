'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createStudyImportRouter,stripMarkdown,bounded,chunks}=require('../../study-import');

function fixture(){const routes=[];const router={post(route,handler){routes.push({route,handler});return this;}};const express={Router(){return router;}};const db={cards:{createMany:async()=>[]},decks:{update:async()=>{},findById:async()=>null}};return{routes,router:createStudyImportRouter({express,db,generateFlashcards:async()=>'',parseFlashcards:()=>[],extractFromImage:async()=>'',generateCBTQuestions:async()=>'',parseCBTResponse:()=>[],estimateCBTCount:()=>1,batchInitializeSeedlingStates:async()=>{},persistKnowledgeScore:async()=>{},checkAIRateLimit:()=>false,jobStoreSet:()=>{},wsSend:()=>{},parsers:{}})};}

test('Study import backend module owns every established import route',()=>{const {routes}=fixture();assert.deepEqual(routes.map(item=>item.route),['/ai','/text','/image','/pdf','/docx','/txt','/md','/pptx','/quizlet']);const monolith=fs.readFileSync(path.resolve(__dirname,'../../index.js'),'utf8');assert.match(monolith,/cardRouter\.use\('\/import', createStudyImportRouter/);assert.doesNotMatch(monolith,/cardRouter\.post\('\/import\//);assert.doesNotMatch(monolith,/pdfParse|mammoth|officeparser/);});
test('Study import text normalization stays bounded and deterministic',()=>{assert.equal(bounded(' x '.repeat(50000)).length,80000);assert.deepEqual(chunks('a'.repeat(12001)).map(x=>x.length),[12000,1]);assert.equal(stripMarkdown('# Title\n**Bold** [link](https://example.com)'),'Title\nBold link');});
