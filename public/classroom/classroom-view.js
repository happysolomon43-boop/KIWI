import {
  createComposerShell,
  createNotebookCapture,
  createBoardDialogs,
} from "./reading-tools.js";
import { createSessionClient } from "./session-client.js";
import { node, action, renderChapter, renderEvent } from "./renderers.js";
// The shell keeps one mounted view; stream updates append rather than replacing
// focused inputs or students' reading positions. No browser clock releases a turn.
export function mountClassroomView({
  host,
  classId,
  legacy,
  reviewOnly,
  api,
  transport,
  renderBoard,
  openNotebook,
  onClose,
  onProtected,
  releaseVisuals,
  onTechnical,
  onLeave,
}) {
  const viewAbort = new AbortController();
  const root = node("div", null, "cr-shell"),
    header = node("header", null, "cr-header");
  root.dataset.view = "conversation";
  const title = node("h1", legacy.identity?.course_title || "Classroom");
  header.append(
    title,
    node("p", legacy.identity?.teacher_name || "KIWI Teacher"),
  );
  const classClock = node("p", "Checking class timing…", "cr-clock");
  header.append(classClock);
  let lastClockTime = null,
    clockReceived = performance.now();
  const displayClock = () => {
    if (reviewOnly) {
      classClock.textContent = "Past class · read-only record";
      return;
    }
    const s = store?.snapshot;
    if (!s?.clocks.class_end_at) return;
    if (lastClockTime !== s.server_time) {
      lastClockTime = s.server_time;
      clockReceived = performance.now();
    }
    const remaining = Math.max(
      0,
      new Date(s.clocks.class_end_at) -
        new Date(s.server_time) -
        (performance.now() - clockReceived),
    );
    const seconds = Math.ceil(remaining / 1000);
    classClock.textContent =
      (legacy.mode || "Teaching") +
      " · " +
      Math.floor(seconds / 60) +
      ":" +
      String(seconds % 60).padStart(2, "0") +
      " remaining in the teaching window";
  };
  const clockTimer = reviewOnly ? null : setInterval(displayClock, 1000);
  const status = node("p", "Connecting…", "cr-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  header.append(status);
  const noteStatus = node("p", "", "cr-notebook-status");
  noteStatus.setAttribute("role", "status");
  noteStatus.setAttribute("aria-live", "polite");
  header.append(noteStatus);
  const close = action("Return to course", onClose);
  header.append(close);
  const controls = node("nav", null, "cr-controls");
  controls.setAttribute("aria-label", "Classroom controls");
  header.append(controls);
  const main = node("main", null, "cr-layout"),
    conversation = node("section", null, "cr-conversation"),
    feed = node("div", null, "cr-feed"),
    chapter = node("section", null, "cr-chapter");
  conversation.setAttribute("aria-label", "Class conversation");
  chapter.setAttribute("aria-label", "Complete chapter");
  feed.tabIndex = 0;
  feed.id = "cr-conversation";
  const skip = node("a", "Skip to conversation", "cr-skip");
  skip.href = "#cr-conversation";
  header.prepend(skip);
  const composer = createComposerShell(reviewOnly);
  conversation.append(feed, composer);
  main.append(conversation, chapter);
  root.append(header, main);
  host.replaceChildren(root);
  const notebookCapture = createNotebookCapture({
    api,
    classId,
    status: noteStatus,
    signal: viewAbort.signal,
  });
  const note = (ref, text) => notebookCapture.save(ref, text);
  const boardDialogs = createBoardDialogs({
    host,
    renderBoard: renderOwnedBoard,
    releaseVisuals,
  });
  let closed = false,
    store = null,
    renderedSession = null,
    chapterId = null,
    currentChapter = null,
    loadingChapter = null,
    version = 0,
    newCount = 0,
    atCurrent = true,
    receiptFlight = false,
    seen = new Map(),
    boardSeen = new Set();
  const mobile = matchMedia("(max-width: 760px)"),
    ui = {
      view: "conversation",
      scale: 1,
      width: 36,
      conversationScroll: 0,
      chapterScroll: 0,
    };
  function preferences() {
    try {
      const value = JSON.parse(
        sessionStorage.getItem("kiwi-classroom-reading:" + classId) || "null",
      );
      if (value && ["conversation", "chapter"].includes(value.view))
        Object.assign(ui, value);
    } catch {}
    root.dataset.view = ui.view;
    root.style.setProperty(
      "--cr-reading-scale",
      String(Math.max(1, Math.min(1.5, Number(ui.scale) || 1))),
    );
    root.style.setProperty(
      "--cr-chapter-width",
      Math.max(25, Math.min(50, Number(ui.width) || 36)) + "%",
    );
  }
  preferences();
  root.style.setProperty("--tc-reading-scale", String(ui.scale));
  atCurrent = !(ui.conversationScroll > 0);
  let restoreReading = true;
  function savePreferences() {
    try {
      sessionStorage.setItem(
        "kiwi-classroom-reading:" + classId,
        JSON.stringify(ui),
      );
    } catch {}
  }
  function syncViews() {
    const isMobile = mobile.matches;
    conversation.inert = isMobile && ui.view !== "conversation";
    chapter.inert = isMobile && ui.view !== "chapter";
    conversation.setAttribute("aria-hidden", String(conversation.inert));
    chapter.setAttribute("aria-hidden", String(chapter.inert));
  }
  function selectView(view) {
    ui.view = view;
    root.dataset.view = view;
    syncViews();
    savePreferences();
  }
  mobile.addEventListener("change", syncViews);
  syncViews();
  controls.append(
    action("Conversation", () => selectView("conversation")),
    action("Chapter", () => selectView("chapter")),
  );
  const pause = action("Pause", () =>
    command(store.snapshot.delivery_state === "PAUSED" ? "resume" : "pause"),
  );
  controls.append(pause);
  const claim = action("Start teaching here", () => lease(false)),
    takeover = action("Continue in this tab", () => lease(true));
  controls.append(claim, takeover);
  const paceLabel = node("label", "Pace "),
    pace = node("select");
  pace.name = "classroom-pace";
  pace.setAttribute("aria-label", "Teaching pace");
  paceLabel.append(pace);
  pace.addEventListener("change", () => command("pace", { pace: pace.value }));
  controls.append(paceLabel);
  const sizeLabel = node("label", "Text size "),
    size = node("input");
  size.type = "range";
  size.min = "100";
  size.max = "150";
  size.step = "10";
  size.value = String(ui.scale * 100);
  size.setAttribute("aria-label", "Reading text size");
  size.addEventListener("input", () => {
    ui.scale = Number(size.value) / 100;
    root.style.setProperty("--cr-reading-scale", String(ui.scale));
    root.style.setProperty("--tc-reading-scale", String(ui.scale));
    savePreferences();
  });
  sizeLabel.append(size);
  controls.append(sizeLabel);
  const widthLabel = node("label", "Chapter width "),
    width = node("input");
  width.type = "range";
  width.min = "25";
  width.max = "50";
  width.value = String(ui.width);
  width.setAttribute("aria-label", "Chapter pane width");
  width.addEventListener("input", () => {
    ui.width = Number(width.value);
    root.style.setProperty("--cr-chapter-width", ui.width + "%");
    savePreferences();
  });
  widthLabel.append(width);
  widthLabel.className = "cr-desktop-control";
  controls.append(widthLabel);
  const current = action("Return to current", () => {
    selectView("conversation");
    feed.scrollTop = feed.scrollHeight;
    atCurrent = true;
    newCount = 0;
    current.textContent = "Return to current";
  });
  controls.append(
    current,
    action("Load earlier conversation", () => store.history().catch(error)),
  );
  if (!reviewOnly && legacy.controlsEnabled) {
    controls.append(
      action("Report technical issue", onTechnical),
      action("Leave Class", onLeave),
    );
  }
  const notebook = action("Notebook", openNotebook);
  controls.append(notebook);
  const boardHistory = action("Board history", () =>
    boardDialogs.history(legacy.board || [], boardHistory),
  );
  controls.append(boardHistory);
  feed.addEventListener("scroll", () => {
    atCurrent = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 2;
    ui.conversationScroll = feed.scrollTop;
    savePreferences();
  });
  chapter.addEventListener("scroll", () => {
    ui.chapterScroll = chapter.scrollTop;
    savePreferences();
  });
  function error(e) {
    if (!closed)
      status.textContent =
        "Connection needs attention. Retry safely to check the saved state.";
  }
  const retry = action("Reconnect", () =>
    store
      .refresh()
      .then(() => render(storeData()))
      .catch(error),
  );
  controls.append(retry);
  function storeData() {
    return {
      snapshot: store.snapshot,
      events: [],
      reviewOnly,
      hasLease: store.hasLease,
    };
  }
  async function command(intent, extra) {
    pause.disabled = true;
    pace.disabled = true;
    try {
      await store.control(intent, extra);
    } catch (e) {
      error(e);
    } finally {
      if (store.snapshot) updateControls(store.snapshot);
    }
  }
  async function lease(replace) {
    claim.disabled = true;
    takeover.disabled = true;
    try {
      await (replace ? store.takeover() : store.lease());
    } catch (e) {
      error(e);
    } finally {
      if (store.snapshot) updateControls(store.snapshot);
      confirmReady();
    }
  }
  function renderOwnedBoard(item) {
    return renderBoard(item, {
      onSave:
        !reviewOnly && legacy.notebookAllowed
          ? (_item, text) => {
              const portion = store?.snapshot.released_portions.find((p) =>
                p.content.board_refs.some((r) => r.id === item.boardItemId),
              );
              return notebookCapture.save(
                portion
                  ? {
                      kind: "portion",
                      id: portion.id,
                      version: "1",
                      anchor: null,
                    }
                  : null,
                text,
                item.boardItemId,
              );
            }
          : null,
    });
  }
  function source(ref) {
    if (
      !currentChapter ||
      !["chapter", "source_element", "chapter_unit"].includes(ref.kind) ||
      ref.id !== currentChapter.id ||
      ref.version !== currentChapter.version
    ) {
      status.textContent = "This reference belongs to another chapter version.";
      return;
    }
    selectView("chapter");
    const target = [...chapter.querySelectorAll("[data-anchor]")].find(
      (n) => n.dataset.anchor === ref.anchor,
    );
    if (target) {
      target.scrollIntoView({ block: "center", behavior: "instant" });
      target.focus({ preventScroll: true });
    }
  }
  function updateControls(s) {
    pause.textContent = s.delivery_state === "PAUSED" ? "Resume" : "Pause";
    pause.disabled =
      reviewOnly ||
      !store.hasLease ||
      !s.permitted_actions.includes(
        s.delivery_state === "PAUSED" ? "resume" : "pause",
      );
    claim.hidden =
      reviewOnly || store.hasLease || !s.permitted_actions.includes("claim");
    takeover.hidden =
      reviewOnly || store.hasLease || !s.permitted_actions.includes("takeover");
    pace.disabled =
      reviewOnly || !store.hasLease || !s.permitted_actions.includes("pace");
    if (
      pace.options.length !== s.pace_profiles.length ||
      [...pace.options].some((o, i) => o.value !== s.pace_profiles[i])
    ) {
      pace.replaceChildren(
        ...s.pace_profiles.map((p) => {
          const o = node("option", p);
          o.value = p;
          return o;
        }),
      );
    }
    pace.value = s.pace;
    notebook.disabled = legacy.notebookAllowed !== true;
    boardHistory.disabled = legacy.boardHistoryAllowed !== true;
  }
  async function loadChapter(s) {
    const key = s.chapter_ref && s.chapter_ref.id + "@" + s.chapter_ref.version;
    if (!key) {
      chapter.replaceChildren(
        node("p", "Chapter is unavailable during this activity."),
      );
      currentChapter = null;
      return;
    }
    if (key === chapterId || key === loadingChapter) return;
    loadingChapter = key;
    const requestVersion = ++version;
    try {
      const c = await api(
        "/teaching/classes/" +
          encodeURIComponent(classId) +
          "/classroom/chapter",
        { signal: viewAbort.signal },
      );
      if (closed || requestVersion !== version) return;
      if (c.id !== s.chapter_ref.id || c.version !== s.chapter_ref.version)
        throw Error("CLASSROOM_CHAPTER_VERSION_MISMATCH");
      currentChapter = c;
      chapterId = key;
      chapter.replaceChildren(
        renderChapter(c, { onNote: reviewOnly ? null : note }),
      );
      chapter.scrollTop = ui.chapterScroll;
      highlight(s);
    } catch (e) {
      if (!closed) {
        chapter.replaceChildren(
          node("p", "Chapter could not be confirmed. Reconnect to retry."),
        );
        error(e);
      }
    } finally {
      if (requestVersion === version && loadingChapter === key)
        loadingChapter = null;
    }
  }
  function highlight(s) {
    const presented = new Set(
      [...feed.querySelectorAll("[data-source-anchor]")].map(
        (n) => n.dataset.sourceAnchor,
      ),
    );
    for (const element of chapter.querySelectorAll("[data-anchor]")) {
      const label = element.querySelector("[data-reading-status]");
      if (label)
        label.textContent = presented.has(element.dataset.anchor)
          ? "Presented in this class"
          : "Available for reading";
      const active = element.dataset.anchor === s.position.resume_anchor;
      element.classList.toggle("is-current", active);
      if (active) element.setAttribute("aria-current", "location");
      else element.removeAttribute("aria-current");
    }
  }
  async function confirmReady() {
    const s = store?.snapshot,
      p = s?.released_portions?.find(
        (p) => p.ordinal === s.position.last_published,
      );
    if (
      closed ||
      reviewOnly ||
      !store?.hasLease ||
      receiptFlight ||
      document.visibilityState !== "visible" ||
      !p ||
      p.render_confirmed
    )
      return;
    const required = p.required_asset_ids || [];
    const images = [...feed.querySelectorAll("img")];
    const ready = required.filter((id) =>
      images.some(
        (img) =>
          img.dataset.assetId === id && img.complete && img.naturalWidth > 0,
      ),
    );
    if (ready.length !== required.length) return;
    if (![...seen.values()].some((n) => n.dataset.eventId === p.event_id))
      return;
    const boardRefs = p.content.board_refs || [];
    if (boardRefs.some((ref) => !boardSeen.has(ref.id))) return;
    receiptFlight = true;
    try {
      await store.receipt({
        portionId: p.id,
        renderState: "accessible_ready",
        active: true,
        representationReady: true,
        readyAssetIds: ready,
      });
    } catch (e) {
      error(e);
    } finally {
      receiptFlight = false;
    }
  }
  const visible = () => confirmReady();
  document.addEventListener("visibilitychange", visible);
  function thisProtected() {
    version++;
    releaseVisuals?.(feed);
    feed.replaceChildren();
    chapter.replaceChildren();
    currentChapter = null;
    notebook.disabled = true;
    onProtected();
  }
  function render(data) {
    if (closed) return;
    const s = data.snapshot;
    if (!s) return;
    if (renderedSession !== s.session_id) {
      if (renderedSession) {
        releaseVisuals?.(feed);
        feed.replaceChildren();
        seen.clear();
        boardSeen.clear();
        chapterId = null;
        currentChapter = null;
        loadingChapter = null;
        version++;
      }
      renderedSession = s.session_id;
    }
    if (!s.chapter_ref) {
      thisProtected();
      return;
    }
    updateControls(s);
    displayClock();
    status.textContent =
      (reviewOnly
        ? "Past class · "
        : s.delivery_state.toLowerCase().replaceAll("_", " ")) +
      " · " +
      (s.clocks.class_end_at
        ? "Class ends " +
          new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(
            new Date(s.clocks.class_end_at),
          )
        : "Timing unavailable");
    const oldScroll = feed.scrollTop,
      follow = atCurrent;
    for (const event of data.events || []) {
      if (seen.has(event.sequence)) continue;
      const element = renderEvent(event, {
        onSource: source,
        onNote: reviewOnly ? null : note,
      });
      element.dataset.eventId = event.id;
      seen.set(event.sequence, element);
      const next = [...feed.children].find(
        (n) => Number(n.dataset.sequence) > event.sequence,
      );
      feed.insertBefore(element, next || null);
      if (!follow) newCount++;
    }
    const items = (legacy.board || []).flatMap((scene) => scene.items || []);
    for (const p of s.released_portions) {
      for (const ref of p.content.board_refs || []) {
        if (boardSeen.has(ref.id)) continue;
        const item = items.find(
          (i) => i.boardItemId === ref.id || i.board_item_id === ref.id,
        );
        if (!item) continue;
        const board = renderOwnedBoard(item);
        board.dataset.boardId = ref.id;
        if (item.content?.assetId)
          for (const img of board.querySelectorAll("img")) {
            img.dataset.assetId = item.content.assetId;
            if (p.required_asset_ids.includes(item.content.assetId))
              img.loading = "eager";
            img.addEventListener("load", confirmReady, { once: true });
          }
        const target = [...seen.values()].find(
          (n) => n.dataset.eventId === p.event_id,
        );
        if (!target) continue;
        target.dataset.portionId = p.id;
        (target || feed).append(board);
        const expand = action("Expand Board reference", () =>
          boardDialogs.expand(board, expand),
        );
        board.append(expand);
        boardSeen.add(ref.id);
      }
    }
    if (restoreReading && feed.children.length) {
      feed.scrollTop = ui.conversationScroll;
      restoreReading = false;
    } else if (follow) feed.scrollTop = feed.scrollHeight;
    else {
      feed.scrollTop = oldScroll;
      current.textContent = newCount
        ? "Return to current · " + newCount + " new"
        : "Return to current";
    }
    loadChapter(s);
    highlight(s);
    queueMicrotask(confirmReady);
  }
  store = createSessionClient({
    api,
    transport,
    classId,
    reviewOnly,
    onChange: render,
    onError: error,
  });
  store.start().catch(error);
  return {
    referenceFor(element) {
      const source = element.closest(".cr-source");
      if (source && currentChapter)
        return {
          kind: "chapter",
          id: currentChapter.id,
          version: currentChapter.version,
          anchor: source.dataset.anchor,
        };
      const event = element.closest(".cr-event");
      return event
        ? {
            kind: "message",
            id: event.dataset.eventId,
            version: "1",
            anchor: null,
          }
        : null;
    },
    navigateReference(ref, loaded = false) {
      if (ref.kind === "board") {
        const item = (legacy.board || [])
          .flatMap((s) => s.items || [])
          .find((i) => i.boardItemId === ref.id);
        if (item) boardDialogs.item(item, document.activeElement);
        else status.textContent = "This Board reference is unavailable.";
        return;
      }
      if (ref.kind === "portion") {
        const target = [...seen.values()].find(
          (n) => n.dataset.portionId === ref.id,
        );
        if (target) {
          selectView("conversation");
          target.scrollIntoView({ block: "center" });
        } else
          status.textContent =
            "Open Board history to review this earlier representation.";
        return;
      }
      if (ref.kind === "chapter") source(ref);
      else if (ref.kind === "message") {
        const element = [...seen.values()].find(
          (n) => n.dataset.eventId === ref.id,
        );
        if (element) {
          selectView("conversation");
          element.scrollIntoView({ block: "center" });
        } else if (!loaded)
          store
            .history()
            .then(() => this.navigateReference(ref, true))
            .catch(error);
        else
          status.textContent =
            "This saved reference is unavailable in the current record.";
      }
    },
    update(next) {
      legacy = next;
      if (["ASSESSMENT", "CLASSWORK"].includes(next.modeKey)) {
        this.close();
        onProtected();
        return;
      }
      if (store.snapshot) render(storeData());
    },
    close() {
      if (closed) return;
      closed = true;
      version++;
      boardDialogs.close();
      viewAbort.abort();
      clearInterval(clockTimer);
      store.close();
      mobile.removeEventListener("change", syncViews);
      document.removeEventListener("visibilitychange", visible);
      releaseVisuals?.(root);
      root.remove();
      seen.clear();
      boardSeen.clear();
      currentChapter = null;
      notebookCapture.close();
    },
  };
}
