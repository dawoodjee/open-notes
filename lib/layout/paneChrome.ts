/**
 * Which pane owns which control, for every combination of hidden panes.
 *
 * WHY THIS IS A MODULE AND NOT AN INLINE TERNARY. Desktop has two independently
 * collapsible panes -- the folder sidebar and the note list -- so there are four
 * combinations, and the controls MOVE between panes as they collapse rather than
 * just appearing and disappearing. The restore-folders affordance lives in the
 * folder pane's own header when folders are shown, and in the LIST pane's header
 * when they are not. Get one combination wrong and the app has either two ways to
 * restore the same pane or none at all, and the missing-control case is invisible
 * from any single screenshot: every individual screen looks fine, and only the
 * transition between two of them is broken.
 *
 * That is the exact failure the stage plan flagged as most likely, so it is
 * decided here, in one function, with the invariants asserted in tests instead of
 * discovered on a device.
 *
 * The reference for the two collapsed states is
 * `dev-docs/design/iteration-2/floating-menu/desktop-top-bar-groups.png` (folders hidden, list shown) and
 * `dev-docs/design/iteration-2/floating-menu/desktop-minimize-restore-states.png` (both hidden).
 */

export interface PaneVisibility {
  /** The folder sidebar. */
  foldersVisible: boolean;
  /** The note list. Apple calls hiding this "maximising" the editor. */
  listVisible: boolean;
}

export interface PaneChrome {
  /** New Folder sits in the folder pane's own header, only while it is shown. */
  folderPaneShowsNewFolder: boolean;
  /** ...alongside the control that collapses it. */
  folderPaneShowsCollapse: boolean;
  /**
   * The control that brings the folder pane BACK, sitting to the left of the
   * folder name and note count. Only in the list pane, and only when the list
   * is the leftmost thing on screen.
   */
  listPaneShowsRestoreFolders: boolean;
  /** The control that collapses the list, hiding it into the editor. */
  listPaneShowsCollapse: boolean;
  /**
   * The editor's left group grows a restore control when the list is hidden,
   * because at that point the editor is the only pane left to put it in. This
   * is what turns the editor's lone compose circle into a two-icon capsule --
   * see icon-buttons-groups-dark.png for why that is a capsule and not two
   * adjacent circles.
   */
  editorShowsRestorePanes: boolean;
}

/**
 * Each restore control brings back the pane immediately to ITS OWN LEFT, which
 * is why there is never more than one of them: the leftmost visible pane owns
 * the only one.
 */
export function paneChrome({ foldersVisible, listVisible }: PaneVisibility): PaneChrome {
  return {
    folderPaneShowsNewFolder: foldersVisible,
    folderPaneShowsCollapse: foldersVisible,
    listPaneShowsRestoreFolders: !foldersVisible && listVisible,
    listPaneShowsCollapse: listVisible,
    editorShowsRestorePanes: !listVisible,
  };
}

/**
 * How many controls currently offer to bring a hidden pane back.
 *
 * Exists for the test rather than for the app: "exactly one, always" is the
 * property that makes the matrix correct, and it is far easier to assert than
 * to eyeball.
 */
export function restoreControlCount(v: PaneVisibility): number {
  const c = paneChrome(v);
  return (c.listPaneShowsRestoreFolders ? 1 : 0) + (c.editorShowsRestorePanes ? 1 : 0);
}
