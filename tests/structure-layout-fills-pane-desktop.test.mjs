// Layout to the pane's shape, desktop size (see _layout-diagram.mjs).
// Before the change the board covered 12.7 % of the pane.
import { test } from 'node:test';
import { fitFill } from './_layout-diagram.mjs';

test('layout at 640 x 480: the board at Fit covers at least 40 % of the pane', async () => {
  await fitFill({ width: 640, height: 480, narrow: false, min: 0.40 });
});
