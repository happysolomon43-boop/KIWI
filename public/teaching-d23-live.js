// Retired visible-shell compatibility guard.
//
// D23's replacement Teaching shell is no longer an active frontend. This file
// intentionally contains no UI implementation. It only protects students who
// still have the first experimental document cached in an open browser tab.
// That document referenced this exact URL together with the original Teaching
// shell, causing two UI owners to compete for the same DOM.

if (document.querySelector('.d23-shell')) {
  const clean = new URL('/teaching.html', window.location.origin);
  clean.searchParams.set('teaching-ui', 'original-20261003');
  if (window.location.href !== clean.href) window.location.replace(clean.href);
}

export {};