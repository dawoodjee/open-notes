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
import './plainTextBody.test';
import './paragraphStyle.test';
import './editorChrome.test';
import './findMatches.test';
import './reorder.test';
import './syncedSettings.test';
import './gateKey.test';
import './resolveSetting.test';
import './folderPane.test';
import './headTags.test';
import './htmlToMarkdown.test';
import './markdownToHtml.test';
import './archiveLayout.test';
import './suspension.test';
import './signups.test';
import './editGate.test';
import { report } from './harness';

report();
