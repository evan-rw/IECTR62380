// A progress window in the Windows 2000 manner: a title bar, a line saying what is happening, a sunken
// bar of 20 dark blue blocks (one per 5 %), and Cancel. Finished blocks are solid; the block being
// worked on blinks.

import { esc } from './html.js';

export const BLOCKS = 20;

// How many blocks are solid for a fraction done, and which one is being worked on (none when finished).
export function blocksFor(fraction) {
  const f = Math.min(1, Math.max(0, Number(fraction) || 0));
  const done = Math.floor(f * BLOCKS + 1e-9);
  return { done, current: done < BLOCKS ? done : null, percent: Math.floor(f * 100) };
}

// onCancel: called when Cancel is pressed; the window then closes itself.
export function openProgress({ title, text = '', onCancel = null }) {
  const box = document.createElement('div');
  box.className = 'progress-window';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', title);
  box.innerHTML = `<h2>${esc(title)}</h2>
    <p class="progress-text" aria-live="polite">${esc(text)}</p>
    <div class="progress-bar" role="progressbar" aria-label="${esc(title)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">${'<span></span>'.repeat(BLOCKS)}</div>
    <p class="progress-actions"><button type="button" data-act="cancel-import">Cancel</button></p>`;
  document.body.append(box);
  const bar = box.querySelector('.progress-bar');
  const blocks = [...bar.children];
  const line = box.querySelector('.progress-text');
  let shownDone = -1;
  const handle = {
    element: box,
    onCancel,
    set(fraction, message) {
      if (message != null && line.textContent !== message) line.textContent = message;
      const { done, current, percent } = blocksFor(fraction);
      bar.setAttribute('aria-valuenow', String(percent));
      // Only a new block changes the picture.
      if (done === shownDone) return;
      shownDone = done;
      blocks.forEach((b, i) => { b.className = i < done ? 'done' : i === current ? 'current' : ''; });
    },
    close() { box.remove(); },
  };
  box.querySelector('[data-act="cancel-import"]').addEventListener('click', (e) => {
    e.stopPropagation();
    handle.close();
    handle.onCancel?.();
  });
  handle.set(0);
  return handle;
}
