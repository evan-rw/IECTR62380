// Shared body of the layout-fills-pane tests (desktop and phone sizes).
//
// lay the top level out to the pane's shape, so Fit shows the board
// as large as the pane allows. Before the change the top-level row wrapped at
// max(clientWidth / 0.8, widest block), and big series blocks use
// ceil(sqrt(n * 2.5)) columns whatever the pane, so a board of many proposals
// becomes a tall column: vme-wren is 1322 x 2598 in a 683 x 639 pane (Fit 23 %,
// 3.2 px text); with every proposal accepted it is 906 x 3424 on a desktop
// (Fit 17 %, 23 % of the pane's width used) and 454 x 10593 on a phone, where
// Fit stops at its 6 % floor and still cuts the board off (report.md).
import assert from 'node:assert/strict';
import { openPage, railsNetlist, settle } from './_page-diagram.mjs';

export async function fitFill({ width, height, narrow, min }) {
  const p = await openPage({ width, height, narrow });
  await p.importNetlist('rails.net', railsNetlist(30));
  if (narrow) p.$('[role="tab"][data-tab="diagram"]').click();
  await settle(30);
  p.$('[data-st="fit"]').click();
  await settle(30);
  const board = p.boardRect();
  const b = p.toScreen(board);
  const fill = (b.w * b.h) / (width * height);
  const msg = `${(fill * 100).toFixed(1)} % of the ${width} x ${height} pane at Fit (k=${p.view().k.toFixed(3)}, board ${board.w} x ${board.h})`;
  assert.ok(p.inPane(b, 2), `Fit shows the whole board: ${msg}`);
  assert.ok(fill >= min, `the board covers ${msg}; want >= ${(min * 100).toFixed(0)} %`);
  return fill;
}
