# D01 security and privilege boundary

Teaching browser code is presentation/input only. The following future operations are server-authoritative and may never trust a browser assertion as sufficient authority:

- finalizing an official grade;
- locking a formal assessment package;
- deciding a formal academic request;
- updating authoritative schedule state.

D01 exposes no such mutation endpoints; it creates the fail-closed operation registry used by later domain services.

## Secret policy

Teaching feature/domain code must contain no database credentials, service-role keys, provider API keys, hard-coded admin tokens or provider SDK calls. Provider/model routing stays in KIWI's central AI Orchestrator.

The existing KIWI monolith is audited separately during D01. Runtime secrets must be supplied through server environment configuration, never public Teaching JavaScript.

## Supabase note

D01 creates no Teaching tables. Existing `public.notifications` and four other existing public tables have RLS disabled in the current production project. That is pre-existing platform debt and is not silently changed in D01 because adding RLS without correct policies can break current behavior. D04 owns Teaching persistence/security; the existing table owners must define correct policies before remediation.
