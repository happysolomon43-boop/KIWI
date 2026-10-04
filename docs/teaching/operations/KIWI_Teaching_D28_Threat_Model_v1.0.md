# KIWI Teaching D28 Production Threat Model v1.0

D28 hardens existing owners; it does not create academic authority.

Protected assets remain owned by their established domains: Gradebook owns official marks, Assessment owns locked packages, Assessment Attempt owns submitted responses and timer facts, Attendance owns attendance, Scheduler owns academic time, Requests/Course Lifecycle own their decisions, and Progression owns outcomes. D28 can observe, reject unauthorized access, alert, audit, budget, retain/suppress operational artifacts, and request owner-preserving recovery only.

Production threats covered: grade tampering; unreleased assessment leakage; cross-student access; prompt/content injection from Subject/uploads/student text; privilege escalation and RLS bypass; unsafe Board/free-text rendering; malicious or oversized uploads; telemetry exfiltration of credentials/raw responses/hidden reasoning; and operational alerts or item statistics being mistaken for academic authority.

Controls: trusted-backend guards for grading finalization, package locking, activation, Request approval, progression finalization, attendance correction, grading-policy locks and assessment timers; server-only runtime storage and revoked browser grants; protected/public assessment payload separation; capability-scoped context minimization; structured render sanitization and dangerous-URI rejection; upload MIME/extension/signature/size validation; redacted reference-only telemetry; exact source/version binding; replay-safe IDs; and governed review rather than automatic academic action.

The browser remains untrusted for authoritative mutations. The Teaching Orchestrator remains non-authoritative. The central KIWI AI Orchestrator remains the only provider/model execution boundary. D28 stores no hidden chain-of-thought.

Failure posture: security uncertainty fails closed for privileged access, but KIWI failure never fabricates student action, evidence, attendance or penalty. Observability-trigger failure is isolated from authoritative transactions. Unqualified/unavailable consequential PPL routes defer safely rather than lowering standards. Corrupted assessment packages are quarantined and routed to existing Assessment/TPF-14/Gradebook fairness owners.
