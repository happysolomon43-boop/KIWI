# D24 — Responsive Design, Accessibility & Visual System

D24 completes only TCH-0504–TCH-0521 and TCH-0582–TCH-0598. It composes the accepted D23 information architecture and the existing D14/D17–D22 academic surfaces; it does not create a shell, academic record, timer, marks source, or accommodation approval authority.

## Implemented outcome

- Desktop Teaching uses a persistent local navigation rail while retaining the original KIWI Teaching shell.
- Tablet Classroom presents Board and Workspace as two coordinated zones.
- Mobile Teaching retains the accepted five-item dock. Mobile Classroom presents Board, Workspace, or Notebook as one dominant tabbed surface, with Class controls as a secondary sheet.
- Mobile Assessment keeps question context, the server timer, response space, autosave state, and a drawer navigator usable at narrow widths. Constructed, mathematical, and essay responses use the accepted typed workflow. The optional paper-photo path was not retained by D18 and D24 does not fake image capture or OCR.
- Keyboard navigation, skip links, dialog focus containment/restoration, visible focus, logical tab state, screen-reader state announcements, textual status labels, reduced motion, high contrast, forced colors, scalable text, teacher transcripts, and Board visual descriptions are integrated into the existing surfaces.
- Extra time remains a locked Assessment Package input and is enforced by the D17 server-owned attempt expiry. D24 displays a neutral approved timer setting and never changes marks or academic standards.
- Writing assistance is controlled by the locked package resource policy, including spellcheck, autocorrect, and paste behavior.

## Visual state coverage

The production visual system now covers Course Plan; Classroom independent/classwork, break/transition, and assessment takeover; mixed and constructed-response Assessment; Calendar; Work/Assignment; Requests; Results/Record/GPA; remediation/resit/recovery; and mobile Today, Classroom, and Assessment. The pass preserves KIWI typography, hierarchy, spacing, severity, loading/empty/error states, and non-gamified treatment for integrity, failure, resit, and serious academic warnings.

## Authority and persistence

Information architecture remains D23-owned; Classroom D14-owned; assessment package, timer and attempt state D17-owned; renderer behavior D18-owned; marks D20-owned; progression D21-owned; and Teacher identity D22-owned. The canonical documents leave accommodation approval authority unresolved, so D24 consumes only an already approved locked policy. No schema migration is added.

## Verification

The D24 verifier asserts exact task accounting, viewport composition, semantic state coverage, independent module loading, responsive/accessibility CSS, Classroom and Assessment semantics, the absence of a D24 migration, and unchanged authority boundaries. Focused unit tests prove accommodation presentation does not expose or modify marks and that the full canonical visual-state set is covered.
