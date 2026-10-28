// Layout to the pane's shape, phone size (see _layout-diagram.mjs).
// Before the change the board covered 21.7 % of the pane.
import { test } from 'node:test';
import { fitFill } from './_layout-diagram.mjs';

test('layout at 320 x 420: the board at Fit covers at least 40 % of the pane', async () => {
  await fitFill({ width: 320, height: 420, narrow: true, min: 0.40 });
});
