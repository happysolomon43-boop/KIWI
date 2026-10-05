'use strict';

const fs = require('node:fs');
const path = require('node:path');

const htmlPath = path.join(__dirname, '..', 'public', 'teaching.html');
let html = fs.readFileSync(htmlPath, 'utf8');

function replaceExactlyOnce(needle, replacement, label) {
  const count = html.split(needle).length - 1;
  if (count !== 1) throw new Error(`[D31] Expected exactly one ${label} anchor, found ${count}.`);
  html = html.replace(needle, replacement);
}

const legacyStyles = `    .teaching-settings-panel__empty {
      margin-top: 34px;
      border-top: 1px solid var(--teaching-border);
      padding-top: 18px;
      color: var(--teaching-muted);
      font-size: 13px;
      line-height: 1.6;
    }`;

const transparencyStyles = `    .teaching-settings-panel__content {
      display: grid;
      gap: 14px;
      margin-top: 24px;
      padding-top: 18px;
      border-top: 1px solid var(--teaching-border);
    }

    .teaching-transparency-card {
      padding: 16px;
      border: 1px solid var(--teaching-border);
      border-radius: 18px;
      background: linear-gradient(145deg, rgba(98, 217, 165, 0.07), rgba(3, 17, 13, 0.26));
    }

    .teaching-transparency-card__eyebrow {
      margin: 0 0 8px;
      color: var(--teaching-accent);
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .teaching-transparency-card h3 {
      margin: 0;
      color: var(--teaching-text);
      font-family: var(--font-display);
      font-size: 16px;
      line-height: 1.3;
      letter-spacing: -0.02em;
    }

    .teaching-transparency-card p,
    .teaching-transparency-card li {
      color: var(--teaching-muted);
      font-size: 12px;
      line-height: 1.65;
    }

    .teaching-transparency-card p { margin: 9px 0 0; }
    .teaching-transparency-card ul { margin: 12px 0 0; padding-left: 19px; }
    .teaching-transparency-card li + li { margin-top: 8px; }
    .teaching-transparency-card strong { color: #cde8dc; font-weight: 720; }

    .teaching-transparency-status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin-top: 12px;
      padding: 7px 10px;
      border: 1px solid rgba(98, 217, 165, 0.22);
      border-radius: 999px;
      background: rgba(98, 217, 165, 0.08);
      color: #bdebd7;
      font-size: 11px;
      font-weight: 720;
    }

    .teaching-transparency-status::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 0 4px rgba(98, 217, 165, 0.08);
    }`;

if (!html.includes('.teaching-transparency-card {')) {
  replaceExactlyOnce(legacyStyles, transparencyStyles, 'Teaching settings placeholder styles');
}

const legacyMarkup = `    <div class="teaching-settings-panel__empty">
      Teaching-specific settings will live here as the app is built.
    </div>`;

const transparencyMarkup = `    <div class="teaching-settings-panel__content">
      <section class="teaching-transparency-card" aria-labelledby="teachingTransparencyTitle">
        <p class="teaching-transparency-card__eyebrow">Academic transparency</p>
        <h3 id="teachingTransparencyTitle">What KIWI Teaching can — and cannot — see</h3>
        <p>KIWI supports learning and academic workflows, but some evidence remains outside what software can reliably observe.</p>
        <ul>
          <li><strong>Physical and practical skills:</strong> KIWI cannot directly verify real-world technique, laboratory handling, handwriting process, spoken delivery, performance quality, or other physical execution unless a supported evidence source captures it.</li>
          <li><strong>External resources:</strong> KIWI can use information available inside KIWI and supported materials you provide, but it cannot guarantee what books, websites, devices, people, or off-platform tools were or were not used.</li>
        </ul>
      </section>

      <section class="teaching-transparency-card" aria-labelledby="teachingAiTransparencyTitle">
        <p class="teaching-transparency-card__eyebrow">AI assistance</p>
        <h3 id="teachingAiTransparencyTitle">Helpful output is not the academic source of truth</h3>
        <p>Teaching AI features are released under an explicit Product Owner authorization while route-level empirical qualification remains incomplete. Missing evaluation evidence is not treated as a qualification pass.</p>
        <ul>
          <li>AI suggestions remain assistive and can be uncertain or wrong.</li>
          <li>Marks, gradebook records, attendance, progression, locked assessment state, scheduling truth, and other authoritative records keep their own validated owner paths.</li>
          <li>Protected assessment content and academic authority boundaries are not relaxed by the AI release authorization.</li>
        </ul>
        <span class="teaching-transparency-status">Owner-authorized · evidence status preserved</span>
      </section>
    </div>`;

if (!html.includes('id="teachingTransparencyTitle"')) {
  replaceExactlyOnce(legacyMarkup, transparencyMarkup, 'Teaching settings placeholder markup');
}

for (const marker of [
  'id="teachingTransparencyTitle"',
  'Physical and practical skills:',
  'External resources:',
  'route-level empirical qualification remains incomplete',
  'Owner-authorized · evidence status preserved',
]) {
  if (!html.includes(marker)) throw new Error(`[D31] Academic Transparency marker missing: ${marker}`);
}

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('[D31] Applied Academic Transparency limitations UI to Teaching settings.');
