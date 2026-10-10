// One academic store. Browser reading preferences never advance teaching.
export function createSessionClient({
  api,
  transport,
  classId,
  reviewOnly = false,
  onChange,
  onError,
}) {
  const abort = new AbortController(),
    base = "/teaching/classes/" + encodeURIComponent(classId) + "/classroom/";
  const clientId = crypto.randomUUID();
  let snapshot = null,
    cursor = 0,
    events = new Map(),
    leaseToken = null,
    leaseEpoch = null,
    closed = false,
    renewTimer = null,
    reconnectTimer = null,
    streamAbort = null,
    flight = null,
    pending = null;
  const notify = () =>
    onChange?.({
      snapshot,
      events: [...events.values()].sort((a, b) => a.sequence - b.sequence),
      reviewOnly,
      hasLease: !!leaseToken,
    });
  function acceptSnapshot(next) {
    if (
      next.schema_version !== "classroom-domain.v1" ||
      next.wire_schema_version !== "classroom-presentation-wire.v1" ||
      next.class_id !== classId
    )
      throw Error("CLASSROOM_CLIENT_SCHEMA_INCOMPATIBLE");
    if (snapshot && next.session_id !== snapshot.session_id) {
      events.clear();
      snapshot = null;
      cursor = 0;
      leaseToken = null;
      pending = null;
    }
    if (snapshot && next.delivery_version < snapshot.delivery_version) return;
    if (
      leaseToken &&
      (next.control_epoch !== leaseEpoch ||
        (next.clocks?.lease_expires_at &&
          new Date(next.clocks.lease_expires_at) <= new Date(next.server_time)))
    )
      leaseToken = null;
    snapshot = next;
    cursor = next.cursor;
    for (const e of next.conversation) events.set(e.sequence, e);
    if (!next.chapter_ref) {
      events.clear();
      leaseToken = null;
    }
    notify();
  }
  async function refresh() {
    if (closed) return;
    if (flight) return flight;
    flight = (async () => {
      const next = await api(base + "session", { signal: abort.signal });
      if (!closed) acceptSnapshot(next);
      return next;
    })();
    try {
      return await flight;
    } finally {
      flight = null;
    }
  }
  function delta(data) {
    // An in-flight frame may arrive after the authoritative protected snapshot.
    // It must never restore instructional content or mutate a closed client.
    if (closed || !snapshot?.chapter_ref) return;
    if (!snapshot || data.session_id !== snapshot.session_id)
      throw Error("CLASSROOM_SESSION_CHANGED");
    if (data.from_cursor > cursor) throw Error("CLASSROOM_DELTA_GAP");
    let expected = data.from_cursor + 1;
    for (const e of data.events) {
      if (e.sequence !== expected++) throw Error("CLASSROOM_DELTA_GAP");
      const old = events.get(e.sequence);
      if (old && JSON.stringify(old) !== JSON.stringify(e))
        throw Error("CLASSROOM_EVENT_CONFLICT");
      events.set(e.sequence, e);
    }
    if (expected - 1 !== data.to_cursor)
      throw Error("CLASSROOM_DELTA_INCOMPLETE");
    cursor = Math.max(cursor, data.to_cursor);
    notify();
  }
  function body(intent, extra = {}) {
    return {
      schemaVersion: snapshot.schema_version,
      sessionId: snapshot.session_id,
      operationKey: crypto.randomUUID(),
      expectedControllerVersion: snapshot.controller_version,
      expectedDeliveryVersion: snapshot.delivery_version,
      deliveryEpoch: snapshot.delivery_epoch,
      controlEpoch: snapshot.control_epoch,
      clientId,
      ...(leaseToken ? { leaseToken } : {}),
      ...(intent ? { intent } : {}),
      ...extra,
    };
  }
  async function mutate(path, intent, extra = {}) {
    if (reviewOnly || closed || !snapshot) throw Error("CLASSROOM_READ_ONLY");
    if (
      path !== "delivery-receipts" &&
      !snapshot.permitted_actions.includes(intent)
    )
      throw Error("CLASSROOM_CONTROL_UNAVAILABLE");
    if (
      pending &&
      (pending.path !== path ||
        pending.intent !== intent ||
        JSON.stringify(pending.extra) !== JSON.stringify(extra))
    )
      throw Error("CLASSROOM_PREVIOUS_OUTCOME_UNKNOWN");
    pending = pending || { path, intent, extra, body: body(intent, extra) };
    try {
      const result = await api(base + path, {
        method: "POST",
        body: pending.body,
        signal: abort.signal,
      });
      pending = null;
      if (result.leaseToken) {
        leaseToken = result.leaseToken;
        leaseEpoch = result.controlEpoch ?? snapshot.control_epoch;
      }
      await refresh();
      return result;
    } catch (error) {
      if (error.status && error.status < 500) {
        pending = null;
        await refresh().catch(() => {});
      }
      onError?.(error);
      throw error;
    }
  }
  async function runStream() {
    if (closed) return;
    clearTimeout(reconnectTimer);
    streamAbort?.abort();
    streamAbort = new AbortController();
    const signal = streamAbort.signal;
    const controller = streamAbort;
    const cancel = () => controller.abort();
    abort.signal.addEventListener("abort", cancel, {
      once: true,
    });
    try {
      await transport(classId, {
        after: cursor,
        signal,
        onEvent: (type, data) => {
          if (closed) return;
          if (type === "classroom_delta") {
            try {
              delta(data);
            } catch (e) {
              onError?.(e);
              streamAbort.abort();
              refresh().then(runStream).catch(onError);
            }
          } else if (
            type === "classroom_state" &&
            snapshot &&
            data.delivery_version !== snapshot.delivery_version
          ) {
            refresh().catch(onError);
          } else if (type === "cursor_reset_required") {
            streamAbort.abort();
            refresh().then(runStream).catch(onError);
          } else if (type === "transport_error") onError?.(data);
        },
      });
    } catch (e) {
      if (!closed && !signal.aborted) {
        onError?.(e);
      }
    } finally {
      abort.signal.removeEventListener("abort", cancel);
      // Proxies can end a healthy stream without throwing. Reconcile from the
      // owner before reconnecting, with the same committed cursor and clocks.
      if (!closed && !signal.aborted) {
        if (!closed && snapshot)
          reconnectTimer = setTimeout(async () => {
            await refresh().catch(onError);
            if (!closed) runStream();
          }, snapshot.transport.reconnectBackoffMs);
      }
    }
  }
  function renewal() {
    clearTimeout(renewTimer);
    if (closed || reviewOnly || !snapshot) return;
    renewTimer = setTimeout(async () => {
      try {
        if (leaseToken && document.visibilityState === "visible")
          await mutate("client-lease", "renew");
      } catch (e) {
        onError?.(e);
      }
      renewal();
    }, snapshot.transport.clientRenewalMs);
  }
  async function history() {
    let after = 0;
    const target = snapshot.cursor;
    while (after < target && !closed) {
      const data = await api(base + "conversation?after=" + after, {
        signal: abort.signal,
      });
      if (data.from_cursor !== after || data.to_cursor <= after)
        throw Error("CLASSROOM_DELTA_GAP");
      delta(data);
      after = data.to_cursor;
    }
    notify();
  }
  return {
    refresh,
    history,
    delta,
    async start() {
      await refresh();
      if (!reviewOnly) {
        runStream();
        renewal();
      }
    },
    lease: () => mutate("client-lease", "claim"),
    takeover: () => mutate("client-lease", "takeover"),
    control: (intent, extra) => mutate("presentation-controls", intent, extra),
    receipt: (extra) => mutate("delivery-receipts", null, extra),
    get snapshot() {
      return snapshot;
    },
    get hasLease() {
      return !!leaseToken;
    },
    close() {
      closed = true;
      abort.abort();
      streamAbort?.abort();
      clearTimeout(renewTimer);
      clearTimeout(reconnectTimer);
      events.clear();
      snapshot = null;
      cursor = 0;
      leaseToken = null;
      pending = null;
    },
  };
}
