'use strict';
const {failure}=require('./presentation-policy');
const {ASSISTANCE_LEVELS,determineBoundedPedagogyFromEvaluation,enforceAssistanceCeiling}=require('../d12/contracts');
const map={probe:'focused probe',hint:'hint',independent_attempt:'independent attempt',evidence_task:'further verification',micro_remediation:'request replanning',misconception_repair:'misconception repair',change_representation:'representation change',replan:'request replanning'};
function select(evaluation,proposal,{task,currentAssistance='none',failedStrategies=[]}){
 const bounds=determineBoundedPedagogyFromEvaluation(evaluation,{currentAssistance,assistanceCeiling:task.assistance_ceiling,failedStrategyClasses:failedStrategies});
 let action=map[bounds.recommended_action];if(!action)throw failure('CLASSROOM_TASK_ACTION_UNSUPPORTED');
 if(action==='hint'&&task.assistance_ceiling==='none')action='focused probe';
 return {action,task_ref:task.id,assistance_ceiling:task.assistance_ceiling,current_assistance:currentAssistance,inference_ceiling:task.inference_ceiling,new_task_required:['focused probe','independent attempt','further verification'].includes(action),reason:proposal?.action===action?'Within existing D12 evidence and assistance bounds':'D12 evidence and assistance bounds constrain the proposed action',proposed_action:proposal?.action||null,officialOutcome:false};
}
function level(proposed,task,current='none'){
 if(!ASSISTANCE_LEVELS.includes(proposed))throw failure('CLASSROOM_TASK_ASSISTANCE_INVALID');
 return enforceAssistanceCeiling({currentLevel:current,proposedLevel:proposed,ceiling:task.assistance_ceiling});
}
module.exports={select,level};
