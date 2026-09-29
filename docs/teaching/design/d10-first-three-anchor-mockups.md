# D10 first-three anchor design gate

This artifact closes TCH-0578–TCH-0581 as a structural mockup/validation gate only. It does not implement the D11 live Teaching Controller.

## Teaching shell + Today anchor

The anchor keeps the existing KIWI Teaching shell, mode switch, side menu and compact bottom dock language. Today is conceived as a calm academic landing surface: current Classes/obligations first, Course risk or action-required conditions second, and non-authoritative analysis clearly subordinate. It must read existing Scheduler/Request/Course facts rather than creating a second status store.

Structural mockup:

```
KIWI / Teaching
Today
[ next authoritative Class / current obligation ]
[ Courses needing action ] [ schedule or Request status ]
[ upcoming work / calendar facts ]
bottom dock: established Teaching destinations + Menu
```

Validation: recognizable KIWI shell; academic commitments outrank motivational chrome; warnings are noticeable but not gamified; browser projections are not treated as authority.

## Course Home anchor

Course Home keeps the Course identity and lifecycle visible, then groups the Course Plan, Schedule, Activation/Rules and later academic tools as attached Course capabilities. D10's activation card is the bridge between setup and the active academic commitment.

Structural mockup:

```
Course title · lifecycle
[ authoritative status / next academic action ]
[ Course Plan ] [ Semester & Timetable ]
[ Final Course Review / Academic Rules ]
[ later Teaching / Work / Results capability slots ]
```

Validation: lifecycle, overlays and later progression outcomes remain visually separable; no duplicate curriculum/schedule truth; post-activation changes route to Requests.

## Normal Live Classroom anchor

The normal Classroom anchor is deliberately a non-functional D10 mockup. It establishes composition only so D11 can implement the Controller without inventing a new visual grammar.

Structural mockup:

```
Course / Class identity        authoritative Class clock/status
Teacher instruction / representation
student response workspace
bounded action/help controls · contextual **Request Early Dismissal** entry
quiet evidence/status rail
```

Validation: classroom focus is stronger than ordinary browsing while retaining KIWI identity; teacher personality cannot alter standards; Assessment/graded modes require visibly stronger future treatment; attendance and instructional substates are not conflated with Class lifecycle.

## Gate result

The three anchors establish a consistent relationship: existing KIWI shell → Course workspace → focused Classroom. Density is moderate, academic authority is visible, serious states are not gamified, and the D10 production UI may implement Stage 6/7 and Requests without pulling the D11 live-class runtime forward.


Contextual Request hook validation: Calendar binds reschedule/emergency absence to the current Class; Course Home binds Break/Pause/Resume/Teacher Change to the current Course; the D10 UI contract also exposes Assignment Extension and Classroom Early Dismissal hooks so later D16/D11 surfaces can attach without creating a second Request model.
