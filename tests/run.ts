/**
 * Test entry point. `npm test`.
 *
 * Imports each suite for its side effects (the describe/it calls register and
 * run immediately), then reports once. Kept explicit rather than globbing, so
 * a new suite is a deliberate line in a diff.
 */
import './grouping.test';
import './note.test';
import './swipeMath.test';
import './htmlMigrate.test';
import './paneChrome.test';
import './toolbarContext.test';
import { report } from './harness';

report();
