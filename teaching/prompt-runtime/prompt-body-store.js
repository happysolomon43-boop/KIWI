'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const HISTORICAL_DIRECTORY=path.join(__dirname,'frozen','v1.3');
const SUCCESSOR_DIRECTORY=path.join(__dirname,'frozen','v1.4');

function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function fail(message,code='TEACHING_PROMPT_BODY_STORE_INVALID'){const e=new Error(message);e.code=code;throw e;}

function loadPromptBodyStore({directory=HISTORICAL_DIRECTORY,successorDirectory=SUCCESSOR_DIRECTORY}={}) {
  const { listPromptFamilies }=require('./prompt-catalog');
  const families=listPromptFamilies();
  const historical=families.filter((f)=>f.id!=='TPF-20');
  const successor=families.filter((f)=>f.id==='TPF-20');
  if(historical.length!==19||successor.length!==1) fail('Prompt body census must preserve 19 historical families plus one TPF-20 successor.');

  const historicalExpected=new Set(historical.map((f)=>f.promptFile));
  const historicalActual=new Set(fs.readdirSync(directory).filter((name)=>fs.statSync(path.join(directory,name)).isFile()));
  if(historicalActual.size!==historicalExpected.size||[...historicalActual].some((name)=>!historicalExpected.has(name))){
    fail('Historical v1.3 prompt directory contains missing or unmanifested prompt text.','TEACHING_UNMANIFESTED_PROMPT_TEXT_REJECTED');
  }
  const successorExpected=new Set(successor.map((f)=>f.promptFile));
  const successorActual=new Set(fs.readdirSync(successorDirectory).filter((name)=>fs.statSync(path.join(successorDirectory,name)).isFile()));
  if(successorActual.size!==successorExpected.size||[...successorActual].some((name)=>!successorExpected.has(name))){
    fail('Successor v1.4 prompt directory must contain exactly the manifest-bound TPF-20 body.','TEACHING_UNMANIFESTED_PROMPT_TEXT_REJECTED');
  }

  const records=new Map();
  for(const family of families){
    const dir=family.id==='TPF-20'?successorDirectory:directory;
    const promptPath=path.join(dir,family.promptFile);
    if(!fs.existsSync(promptPath)) fail(`Missing frozen prompt body: ${family.promptFile}`,'TEACHING_FROZEN_PROMPT_BODY_MISSING');
    const bytes=fs.readFileSync(promptPath);
    const digest=sha256(bytes);
    if(digest!==family.promptSha256) fail(`Frozen prompt body hash mismatch: ${family.id}`,'TEACHING_FROZEN_PROMPT_BODY_HASH_MISMATCH');
    records.set(family.id,Object.freeze({
      familyId:family.id,familyVersion:family.version,promptFile:family.promptFile,promptSha256:digest,
      byteLength:bytes.length,promptText:bytes.toString('utf8'),sourceManifestVersion:family.id==='TPF-20'?'1.4':'1.3',
    }));
  }
  return records;
}

const records=loadPromptBodyStore();

function getFrozenPromptBodyRecord(familyId,version) {
  const key=String(familyId||'').trim().toUpperCase();
  const record=records.get(key);
  if(!record) fail(`Unknown frozen prompt body: ${familyId}`,'TEACHING_FROZEN_PROMPT_BODY_UNKNOWN');
  if(String(version)!==record.familyVersion) fail(`${key} body is frozen at ${record.familyVersion}, not ${version}.`,'TEACHING_PROMPT_VERSION_MISMATCH');
  return record;
}

function assertPromptBodyStoreReady(){
  if(records.size!==20) fail('Frozen prompt body store must expose exactly 20 families.');
  return true;
}

function promptBodyStoreStatus(){
  return Object.freeze({ready:true,familyCount:records.size,historicalFamilyCount:19,successorFamilyCount:1});
}

module.exports={
  HISTORICAL_DIRECTORY,SUCCESSOR_DIRECTORY,loadPromptBodyStore,getFrozenPromptBodyRecord,assertPromptBodyStoreReady,promptBodyStoreStatus,
};
