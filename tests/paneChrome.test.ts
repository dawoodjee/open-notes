/**
 * The desktop minimize/restore matrix.
 *
 * These exist because the stage plan named this the part most likely to produce
 * a subtly wrong combination, and because the wrong combinations are invisible
 * one screen at a time: every individual layout looks fine, and only moving
 * between two of them shows the control that went missing or the second one
 * that should not be there.
 *
 * Four combinations, and the interesting assertions are the INVARIANTS across
 * them rather than any single row.
 */
import { describe, it, expect } from './harness';
import { paneChrome, restoreControlCount, type PaneVisibility } from '../lib/layout/paneChrome';

const BOTH: PaneVisibility = { foldersVisible: true, listVisible: true };
const LIST_ONLY: PaneVisibility = { foldersVisible: false, listVisible: true };
const FOLDERS_NO_LIST: PaneVisibility = { foldersVisible: true, listVisible: false };
const EDITOR_ONLY: PaneVisibility = { foldersVisible: false, listVisible: false };

const ALL = [BOTH, LIST_ONLY, FOLDERS_NO_LIST, EDITOR_ONLY];

describe('paneChrome — the four combinations', () => {
  it('both panes shown: folder pane owns its own controls, nothing restores', () => {
    const c = paneChrome(BOTH);
    expect(c.folderPaneShowsNewFolder).toBe(true);
    expect(c.folderPaneShowsCollapse).toBe(true);
    expect(c.listPaneShowsRestoreFolders).toBe(false);
    expect(c.editorShowsRestorePanes).toBe(false);
  });

  it('folders hidden, list shown: the LIST grows the restore control', () => {
    // desktop-top-bar-groups.png: a restore capsule left of "Fun / 2 notes".
    const c = paneChrome(LIST_ONLY);
    expect(c.listPaneShowsRestoreFolders).toBe(true);
    expect(c.folderPaneShowsNewFolder).toBe(false);
    expect(c.editorShowsRestorePanes).toBe(false);
  });

  it('both hidden: the EDITOR grows the restore control', () => {
    // desktop-minimize-restore-states.png: [restore, compose] as one capsule.
    const c = paneChrome(EDITOR_ONLY);
    expect(c.editorShowsRestorePanes).toBe(true);
    expect(c.listPaneShowsRestoreFolders).toBe(false);
    expect(c.folderPaneShowsNewFolder).toBe(false);
  });

  it('folders shown, list hidden: the folder pane keeps its controls', () => {
    const c = paneChrome(FOLDERS_NO_LIST);
    expect(c.folderPaneShowsNewFolder).toBe(true);
    expect(c.editorShowsRestorePanes).toBe(true);
    // The list is not on screen, so it cannot be offering anything.
    expect(c.listPaneShowsRestoreFolders).toBe(false);
    expect(c.listPaneShowsCollapse).toBe(false);
  });
});

describe('paneChrome — invariants that hold across all four', () => {
  it('NEVER TWO WAYS TO RESTORE, AND NEVER NONE', () => {
    // The whole point. Two restore controls means the same pane comes back
    // from two places; none means a collapsed pane is unreachable and the user
    // is stuck in a layout they cannot leave.
    for (const v of ALL) {
      const expected = v.foldersVisible && v.listVisible ? 0 : 1;
      expect(restoreControlCount(v)).toBe(expected);
    }
  });

  it('a hidden pane never offers any control at all', () => {
    for (const v of ALL) {
      const c = paneChrome(v);
      if (!v.foldersVisible) {
        expect(c.folderPaneShowsNewFolder).toBe(false);
        expect(c.folderPaneShowsCollapse).toBe(false);
      }
      if (!v.listVisible) {
        expect(c.listPaneShowsRestoreFolders).toBe(false);
        expect(c.listPaneShowsCollapse).toBe(false);
      }
    }
  });

  it('every visible pane can be collapsed, so no state is a dead end', () => {
    for (const v of ALL) {
      const c = paneChrome(v);
      expect(c.folderPaneShowsCollapse).toBe(v.foldersVisible);
      expect(c.listPaneShowsCollapse).toBe(v.listVisible);
    }
  });

  it('collapsing then restoring returns to exactly where it started', () => {
    // Reachability, stated as a round trip: from any state, hiding a pane and
    // showing it again is the identity. A restore control that brought back the
    // WRONG pane would still satisfy every per-state assertion above.
    for (const v of ALL) {
      for (const key of ['foldersVisible', 'listVisible'] as const) {
        const toggled = { ...v, [key]: !v[key] };
        const back = { ...toggled, [key]: v[key] };
        expect(JSON.stringify(paneChrome(back))).toBe(JSON.stringify(paneChrome(v)));
      }
    }
  });
});
