'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE_URL = String(process.env.KIWI_PRODUCTION_URL || 'https://kiwi-741i.onrender.com').replace(/\/$/, '');
const AXE_PATH = require.resolve('axe-core/axe.min.js');
const OUT_DIR = path.resolve(process.env.D31_UI_ARTIFACT_DIR || 'artifacts/d31-production-ui');

const targets = Object.freeze([
  Object.freeze({ name: 'home', path: '/' }),
  Object.freeze({ name: 'teaching', path: '/teaching.html' }),
]);

const profiles = Object.freeze([
  Object.freeze({ name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false }),
  Object.freeze({ name: 'mobile-touch', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }),
]);

function fail(message, details = null) {
  const error = new Error(message);
  if (details) error.details = details;
  throw error;
}

function safeFilename(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

async function auditPage(browser, target, profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const runtimeErrors = [];

  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${String(error?.message || error)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
  });

  const response = await page.goto(`${BASE_URL}${target.path}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForTimeout(1_500);

  if (!response) fail(`No HTTP response for ${target.path} (${profile.name}).`);
  if (response.status() >= 500) fail(`Production returned ${response.status()} for ${target.path} (${profile.name}).`);

  const structural = await page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll('[id]')).map((node) => node.id).filter(Boolean);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const doc = document.documentElement;
    const body = document.body;
    const horizontalOverflow = Math.max(doc?.scrollWidth || 0, body?.scrollWidth || 0) - Math.max(doc?.clientWidth || 0, body?.clientWidth || 0);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const visibleControls = Array.from(document.querySelectorAll('button,input,select,textarea,[role="button"]'))
      .filter((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { tag: el.tagName, width: rect.width, height: rect.height, text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 80) };
      });
    const undersizedControls = visibleControls.filter((item) => item.width < 24 || item.height < 24);
    return {
      title: document.title,
      duplicateIds,
      horizontalOverflow,
      reduceMotion,
      visibleControlCount: visibleControls.length,
      undersizedControls,
    };
  });

  if (structural.duplicateIds.length) fail(`Duplicate DOM ids on ${target.path} (${profile.name}).`, structural.duplicateIds);
  if (structural.horizontalOverflow > 2) fail(`Horizontal overflow of ${structural.horizontalOverflow}px on ${target.path} (${profile.name}).`);
  if (!structural.reduceMotion) fail(`Reduced-motion media query was not active on ${target.path} (${profile.name}).`);
  if (profile.hasTouch && structural.undersizedControls.length) {
    fail(`Touch controls below the 24px WCAG 2.2 floor on ${target.path}.`, structural.undersizedControls.slice(0, 20));
  }

  await page.addScriptTag({ path: AXE_PATH });
  const axe = await page.evaluate(async () => {
    const result = await globalThis.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 10).map((node) => node.target),
    }));
  });
  const consequentialA11y = axe.filter((violation) => ['critical', 'serious'].includes(violation.impact));
  if (consequentialA11y.length) fail(`Serious accessibility violations on ${target.path} (${profile.name}).`, consequentialA11y);

  let focusEvidence = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.keyboard.press('Tab');
    focusEvidence = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      const style = getComputedStyle(el);
      return {
        tag: el.tagName,
        label: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || el.id || '').trim().slice(0, 100),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
      };
    });
    if (focusEvidence) break;
  }
  if (!focusEvidence) fail(`Keyboard Tab did not reach an interactive element on ${target.path} (${profile.name}).`);
  const hasVisibleFocus = focusEvidence.outlineStyle !== 'none'
    && focusEvidence.outlineStyle !== 'hidden'
    && focusEvidence.outlineWidth !== '0px'
    || (focusEvidence.boxShadow && focusEvidence.boxShadow !== 'none');
  if (!hasVisibleFocus) fail(`No visible keyboard focus indicator on ${target.path} (${profile.name}).`, focusEvidence);

  const runningAnimations = await page.evaluate(() => document.getAnimations()
    .filter((animation) => animation.playState === 'running')
    .map((animation) => ({ duration: Number(animation.effect?.getTiming?.().duration || 0), iterations: animation.effect?.getTiming?.().iterations || 1 }))
    .filter((animation) => animation.duration > 100 && animation.iterations !== 0));
  if (runningAnimations.length) fail(`Reduced-motion mode still has long-running animations on ${target.path} (${profile.name}).`, runningAnimations.slice(0, 20));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const screenshotPath = path.join(OUT_DIR, `${safeFilename(profile.name)}-${safeFilename(target.name)}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const result = Object.freeze({
    target: target.path,
    profile: profile.name,
    httpStatus: response.status(),
    finalUrl: page.url(),
    title: structural.title,
    visibleControlCount: structural.visibleControlCount,
    focusEvidence,
    seriousAccessibilityViolations: 0,
    runtimeErrorCount: runtimeErrors.length,
    runtimeErrors: runtimeErrors.slice(0, 20),
    screenshotPath,
  });

  await context.close();
  return result;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const profile of profiles) {
      for (const target of targets) {
        results.push(await auditPage(browser, target, profile));
      }
    }
  } finally {
    await browser.close();
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const reportPath = path.join(OUT_DIR, 'report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify({ baseUrl: BASE_URL, checkedAt: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(`[D31] Production UI browser audit passed for ${results.length} viewport/page combinations.`);
  for (const result of results) {
    console.log(`[D31] ${result.profile} ${result.target}: ${result.httpStatus} ${result.finalUrl} | controls=${result.visibleControlCount} | runtimeErrors=${result.runtimeErrorCount}`);
  }
})();
