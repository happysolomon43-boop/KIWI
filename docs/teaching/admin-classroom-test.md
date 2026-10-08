# KIWI Admin Test Classroom — real-engine isolation

## Purpose and activation

Test Classroom reuses the **existing KIWI Classroom frontend, Teaching D11/D14 controllers and services, and AI orchestration**. It must run against a **separately deployed KIWI runtime with a different PostgreSQL database**, never an administrative time override on the real student's Class record.

The primary KIWI account must have a **live database-verified admin role**. Merely possessing the hidden admin panel token, forging a browser role, or discovering the page URL cannot authorize this gateway. Every request re-checks the role in the user table.

**The gateway fails closed until the separate runtime is provisioned.** Landing this code does not mean the separate service is deployed, seeded or live-verified.

## Existing KIWI system execution path

1. Admin opens Teaching → Menu → Test Classroom.
2. The primary KIWI backend authorizes the current account as admin against the live database.
3. Before every request, the backend uses a server-held shared key to attest the isolated KIWI instance.
4. The test KIWI instance must return its full real-engine identity and database identity fingerprint **different from production**. Matching database identity, missing key, wrong service or missing configuration returns 503.
5. The gateway permits only an explicit allowlist of existing KIWI Teaching operations: Course Class listing, Classroom snapshot/private assets, enter, notes, classroom interactions/responses and D11 controller lifecycle operations.
6. The actual **public/teaching-classroom.js** module renders the Classroom. It is not replaced with a mock; only the transport prefix changes.
7. The test instance executes KIWI's normal D11/D14 repositories, Board, Workspace, real model routes and workers. The test user is selected on the server, never from browser input.
8. Test grades, notes, attendance, events and other writes remain in the isolated database.

Real lesson timing, preparation, Class/Plan lineage, and official timetable state still apply. A Class cannot start early merely because it is in the simulator.

## Isolated deployment setup

A second Render KIWI service must be deployed **from the same reviewed commit** with the same real AI orchestration capabilities, plus a dedicated database.

The already available **KIWI Teaching Integration Supabase project** (project reference kmymmwujhotqxtoamyur) has the Teaching schema but was empty of user/Course/Class records at inspection. Provision a dedicated test user, subject and active Course through KIWI's actual workflows, with an approved timetable and prepared lesson. Do not point this service at the production database.

Isolated service server-side environment:
- DATABASE_URL — dedicated integration/staging Postgres database
- KIWI_CLASSROOM_TEST_INSTANCE=true
- KIWI_CLASSROOM_TEST_SHARED_KEY — long random secret, never shipped to clients
- KIWI_CLASSROOM_TEST_USER_ID — test user that exists in the isolated database
- Required regular KIWI provider keys, AI release mode, runtime and worker configuration

Primary service server-side environment:
- KIWI_CLASSROOM_TEST_ORIGIN — HTTPS origin of isolated KIWI backend
- KIWI_CLASSROOM_TEST_SHARED_KEY — same shared key
- KIWI_CLASSROOM_TEST_USER_ID — the test user ID as configuration signal
- KIWI_PUBLIC_ORIGIN — current production origin for same-origin rejection
- DATABASE_URL — unchanged current production URL

The sandbox's Teaching router checks the server-held key and uses only the configured sandbox student ID. The private attestation returns a one-way hash of the database host, name and username, never a credential. Lock down the sandbox service itself at the network edge: its unrelated endpoints are not protected by this module.

## Required activation verification

- Pass the admin gateway's non-admin, same-database, missing-token, and no-forbidden-route unit tests.
- Pass KIWI D11, D14, D05 and D31 regression checks.
- Execute a live sandbox Course Plan → official timetable → lesson preparation → Class start → Board/Workspace → Ask Teacher/Raise Hand → note → response → closure, checking persisted records and real model call traces.
- Confirm that production Courses, timetable, attendance, Gradebook, notifications and Course progress are unchanged before and after the rehearsal.
- Verify a too-early Class and an invalid lesson plan are rejected by the real KIWI authority rules.
- Only then claim a production-ready simulator.

An accelerated clock is **not** implemented by this gateway. A correct fast-forward mode would require coordinated backend clock injection into the scheduler, D02/D05 events, D11 and D14 and their workers. Merely advancing a browser countdown would be a false simulation.
