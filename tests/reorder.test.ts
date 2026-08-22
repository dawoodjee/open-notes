import { describe, it, expect } from './harness';
import { moveToIndex, rowShift, targetIndexFor } from '../lib/notes/reorder';

const list = ['a', 'b', 'c', 'd'];

describe('moveToIndex', () => {
  it('moves an item down', () => {
    expect(moveToIndex(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item up', () => {
    expect(moveToIndex(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moving to the same index changes nothing', () => {
    expect(moveToIndex(list, 2, 2)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('clamps a target past the end', () => {
    expect(moveToIndex(list, 0, 99)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('does not mutate the input', () => {
    moveToIndex(list, 0, 3);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ignores an out-of-range source', () => {
    expect(moveToIndex(list, 9, 0)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('targetIndexFor', () => {
  it('is the start index when nothing has moved', () => {
    expect(targetIndexFor(1, 0, 44, 4)).toBe(1);
  });

  it('claims the next slot at the halfway point, not a full row', () => {
    // 60% of a row down -- the dragged row already covers more of its
    // neighbour than of its origin.
    expect(targetIndexFor(1, 26, 44, 4)).toBe(2);
    // 40% is still short of it.
    expect(targetIndexFor(1, 17, 44, 4)).toBe(1);
  });

  it('moves up on negative travel', () => {
    expect(targetIndexFor(2, -44, 44, 4)).toBe(1);
  });

  it('clamps at both ends', () => {
    expect(targetIndexFor(0, -500, 44, 4)).toBe(0);
    expect(targetIndexFor(3, 500, 44, 4)).toBe(3);
  });

  it('is inert before the row has been measured', () => {
    expect(targetIndexFor(2, 300, 0, 4)).toBe(2);
  });
});

describe('rowShift', () => {
  it('is zero for every row while idle', () => {
    expect([0, 1, 2, 3].map((i) => rowShift(i, -1, -1))).toEqual([0, 0, 0, 0]);
  });

  it('slides the passed rows up when dragging down', () => {
    // 0 dragged to 2: rows 1 and 2 move up one, row 3 is untouched.
    expect([0, 1, 2, 3].map((i) => rowShift(i, 0, 2))).toEqual([0, -1, -1, 0]);
  });

  it('slides the passed rows down when dragging up', () => {
    // 3 dragged to 1: rows 1 and 2 move down one, row 0 is untouched.
    expect([0, 1, 2, 3].map((i) => rowShift(i, 3, 1))).toEqual([0, 1, 1, 0]);
  });

  it('never shifts the dragged row itself', () => {
    expect(rowShift(2, 2, 0)).toBe(0);
  });

  it('is zero when the drag has not left its own slot', () => {
    expect([0, 1, 2, 3].map((i) => rowShift(i, 2, 2))).toEqual([0, 0, 0, 0]);
  });
});
