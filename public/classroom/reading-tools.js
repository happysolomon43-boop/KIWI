import { node, action } from "./renderers.js";
export function createComposerShell(reviewOnly, { send, context = () => null } = {}) {
  const form=node("form",null,"cr-composer"),label=node("label","Message your teacher"),draft=node("textarea"),availability=node("p",reviewOnly?"Past class: read-only review.":"Messages become available after message admission is enabled for this session.","cr-muted"),submit=action("Send message",()=>{}),outcome=node("p",null,"cr-message-outcome"),questions=node("section",null,"cr-question-queue"),lane=node("select");
  draft.name="classroom-message";draft.id="cr-message";draft.autocomplete="off";draft.placeholder="Ask about the current passage…";draft.rows=2;draft.disabled=true;label.htmlFor=draft.id;
  availability.id="cr-message-availability";draft.setAttribute("aria-describedby",availability.id);outcome.setAttribute("role","status");questions.setAttribute("aria-label","Your saved questions");questions.tabIndex=0;lane.setAttribute("aria-label","Message purpose");submit.type="submit";submit.disabled=true;
  form.append(label,draft,lane,availability,submit,outcome,questions);
  let snapshot=null,pending=null,busy=false,storageKey=null,restored=false,closed=false,laneSignature=null;
  function stash(){if(!storageKey||!snapshot?.messages?.draft_retention_ms)return;try{if(!draft.value&&!pending)sessionStorage.removeItem(storageKey);else sessionStorage.setItem(storageKey,JSON.stringify({text:draft.value,pending,lane:lane.value,expiresAt:Date.now()+snapshot.messages.draft_retention_ms}));}catch{}}
  draft.addEventListener("input",stash);lane.addEventListener("change",()=>{if(!pending)stash();state();});
  function state(){const enabled=!reviewOnly&&snapshot?.messages?.enabled;draft.disabled=!enabled;draft.readOnly=busy||!!pending;lane.disabled=busy||!!pending;submit.disabled=!enabled||busy||(!pending&&lane.value==="conversation"&&snapshot.messages.remaining===0);submit.textContent=pending?"Check message acceptance":"Send message";}
  form.update=(next)=>{
    if(closed)return;
    if(snapshot&&snapshot.session_id!==next.session_id){stash();pending=null;draft.value="";restored=false;}
    snapshot=next;storageKey="kiwi-classroom-draft.v1:"+next.session_id;
    const options=[{id:"conversation",text:"Question or contribution"},...(next.messages?.questions||[]).filter(q=>q.clarification_requested).map(q=>({id:q.id,text:"Clarify saved question: "+q.text.slice(0,70)}))];
    const signature=JSON.stringify(options);
    if(signature!==laneSignature){const selected=lane.value;lane.replaceChildren();for(const item of options){const option=node("option",item.text);option.value=item.id;lane.append(option);}lane.value=options.some(o=>o.id===selected)?selected:"conversation";laneSignature=signature;}
    if(!restored&&next.messages?.enabled){restored=true;try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||"null");if(saved&&saved.expiresAt>Date.now()){draft.value=saved.text||"";pending=saved.pending||null;if([...lane.options].some(o=>o.value===saved.lane))lane.value=saved.lane;if(pending)outcome.textContent="A previous send has an uncertain outcome. Check acceptance using the same message.";}else sessionStorage.removeItem(storageKey);}catch{}}
    availability.textContent=reviewOnly?"Past class: read-only review.":next.messages?.enabled?`${next.messages.remaining} conversational messages remaining. Requested clarification and permitted support controls remain available.`:"Messages are unavailable for this session.";
    questions.replaceChildren();for(const q of next.messages?.questions||[]){const row=node("p",q.text+" — "+q.state+" · "+q.handling);row.dataset.messageId=q.id;questions.append(row);}
    state();
  };
  form.addEventListener("submit",async e=>{
    e.preventDefault();if(busy||closed||!snapshot?.messages?.enabled||reviewOnly)return;
    if(!draft.value.trim()){outcome.textContent="Write a message before sending.";return;}
    if(new TextEncoder().encode(draft.value).length>snapshot.messages.max_bytes){outcome.textContent="This message exceeds the session message-size limit.";return;}
    if(!pending){const clarification=lane.value!=="conversation";pending={schemaVersion:"classroom-messages.v1",sessionId:snapshot.session_id,operationKey:crypto.randomUUID(),content:draft.value,intent:clarification?"clarification":"conversation",sourceRef:context(),replyTo:clarification?lane.value:null};}
    stash();busy=true;state();outcome.textContent="Sending…";
    try{const receipt=await send(pending);if(closed)return;outcome.textContent="Accepted and saved. "+receipt.remaining+" conversational messages remaining.";pending=null;draft.value="";stash();}
    catch(error){if(closed)return;if(error.status&&error.status<500){pending=null;outcome.textContent="Not accepted: "+(error.code||error.message)+". Your draft is preserved.";}else outcome.textContent="Acceptance is not confirmed. Check again with the same message; it will not be charged twice.";stash();}
    finally{busy=false;if(!closed)state();}
  });
  form.close=()=>{stash();closed=true;};
  return form;
}
export function createNotebookCapture({ api, classId, status, signal }) {
  const operations = new Map();
  return {
    async save(ref, text, boardItemId = null) {
      const key = JSON.stringify({ ref, boardItemId });
      let operation = operations.get(key);
      if (!operation) {
        operation = {
          content: text,
          idempotencyKey: crypto.randomUUID(),
          ...(ref ? { sourceRef: ref } : {}),
          ...(boardItemId ? { boardItemId } : {}),
        };
        operations.set(key, operation);
      }
      try {
        await api(
          "/teaching/classes/" + encodeURIComponent(classId) + "/notebook",
          { method: "POST", body: operation, signal },
        );
        if (!signal.aborted) status.textContent = "Saved to Notebook.";
      } catch {
        if (!signal.aborted)
          status.textContent =
            "Notebook save not confirmed. Retry the same passage to check safely.";
      }
    },
    close() {
      operations.clear();
    },
  };
}
export function createBoardDialogs({
  host,
  renderBoard,
  releaseVisuals = () => {},
}) {
  let current = null,
    closed = false;
  function show(label, content, opener) {
    if (closed) return;
    current?.close();
    const dialog = node("dialog", null, "cr-expanded-board");
    dialog.setAttribute("aria-label", label);
    dialog.append(
      node("h2", label),
      action("Close Board reference", () => dialog.close()),
      ...content,
    );
    host.append(dialog);
    current = dialog;
    dialog.addEventListener(
      "close",
      () => {
        releaseVisuals(dialog);
        dialog.remove();
        if (current === dialog) current = null;
        if (!closed && opener?.isConnected)
          opener.focus({ preventScroll: true });
      },
      { once: true },
    );
    dialog.showModal();
  }
  return {
    expand(board, opener) {
      const copy = board.cloneNode(true);
      for (const control of copy.querySelectorAll("button")) control.remove();
      show("Expanded Board reference", [copy], opener);
    },
    history(scenes, opener) {
      const content = [];
      for (const scene of scenes) {
        const section = node("section");
        section.append(node("h3", scene.title || "Board scene"));
        for (const item of scene.items || []) section.append(renderBoard(item));
        content.push(section);
      }
      if (!content.length)
        content.push(node("p", "No Board representations have been released."));
      show("Board history", content, opener);
    },
    item(item, opener) {
      show("Expanded Board reference", [renderBoard(item)], opener);
    },
    close() {
      closed = true;
      current?.close();
      current = null;
    },
  };
}
