import { node, action } from "./renderers.js";
export function createComposerShell(reviewOnly) {
  const form = node("form", null, "cr-composer"),
    label = node("label", "Message your teacher"),
    draft = node("textarea");
  draft.name = "classroom-message";
  draft.id = "cr-message";
  draft.autocomplete = "off";
  draft.placeholder = "Ask about the current passage…";
  draft.rows = 2;
  label.htmlFor = draft.id;
  draft.disabled = true;
  const availability = node(
    "p",
    reviewOnly
      ? "Past class: read-only review."
      : "Messages become available after message admission is enabled for this session.",
    "cr-muted",
  );
  availability.id = "cr-message-availability";
  draft.setAttribute("aria-describedby", availability.id);
  form.append(label, draft, availability);
  form.addEventListener("submit", (e) => e.preventDefault());
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
