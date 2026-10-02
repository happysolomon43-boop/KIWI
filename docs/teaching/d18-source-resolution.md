# D18 canonical source resolution

At D18 start, the accepted D17 main baseline was `02ebdd3d77af7ea11d62fddb0116e00aab65dcdd`.

A source-integrity mismatch was found in delivery prose: the accepted D17→D18 handoff's task-by-task implementation-direction section assigned new descriptive meanings to several permanent IDs beginning at `TCH-0363`, while Delivery Task Map v1.7 and Master Implementation Backlog v9.7 retained the frozen permanent task meanings for `TCH-0357`–`TCH-0375`.

Resolution followed the project precedence rules rather than inventing a redesign: Delivery Task Map v1.7 / Master Backlog v9.7 remain authoritative for the permanent TCH meaning, and the D17→D18 handoff remains authoritative as additional D18 implementation and acceptance guidance where it does not rename those permanent tasks.

Therefore D18 implements the permanent renderer/UI tasks (including numeric+unit, essay, source layout, code, visual extension, question states, free navigation, allowed tools, save-state and Review Mode) while also implementing the handoff's required server-acknowledged autosave, restore/reconnect, submit/expiry, device-transfer and protected-content protections as cross-cutting acceptance behavior.

No frozen prompt content, Assessment authority boundary, route qualification state or persistence owner was changed to resolve this documentation conflict.
