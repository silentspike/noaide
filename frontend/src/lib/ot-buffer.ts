/**
 * Operational Transform Buffer
 *
 * Holds user edits while Claude is writing to the same file.
 * On completion, executes a 3-way merge (base, theirs=Claude, ours=user).
 * If conflicts remain, signals that Merge View should open.
 */

export interface OTEdit {
  offset: number;
  deleteCount: number;
  insert: string;
  timestamp: number;
}

export interface MergeResult {
  merged: string;
  hasConflicts: boolean;
  conflicts: ConflictRegion[];
}

export interface ConflictRegion {
  startLine: number;
  endLine: number;
  ours: string;
  theirs: string;
  base: string;
}

export class OTBuffer {
  private edits: OTEdit[] = [];
  private baseContent: string;
  private active = false;

  constructor(baseContent: string) {
    this.baseContent = baseContent;
  }

  /** Start buffering user edits (Claude began editing) */
  start(currentBase: string): void {
    this.baseContent = currentBase;
    this.edits = [];
    this.active = true;
  }

  /** Buffer a user edit */
  push(edit: OTEdit): void {
    if (!this.active) return;
    this.edits.push(edit);
  }

  /** Check if buffer is active */
  isActive(): boolean {
    return this.active;
  }

  /** Apply buffered edits to get user's version */
  applyEdits(content: string): string {
    let result = content;
    // Apply edits in order, adjusting offsets
    for (const edit of this.edits) {
      const before = result.slice(0, edit.offset);
      const after = result.slice(edit.offset + edit.deleteCount);
      result = before + edit.insert + after;
    }
    return result;
  }

  /**
   * Complete buffering and attempt 3-way merge.
   * @param theirContent Claude's final version
   * @returns MergeResult with merged content or conflicts
   */
  resolve(theirContent: string): MergeResult {
    this.active = false;

    if (this.edits.length === 0) {
      return { merged: theirContent, hasConflicts: false, conflicts: [] };
    }

    const ourContent = this.applyEdits(this.baseContent);
    return threeWayMerge(this.baseContent, ourContent, theirContent);
  }

  /** Discard buffer without merging */
  discard(): void {
    this.edits = [];
    this.active = false;
  }
}

/**
 * Line-based 3-way merge.
 * base = original, ours = user changes, theirs = Claude changes.
 */
function threeWayMerge(base: string, ours: string, theirs: string): MergeResult {
  const baseLines = base.split("\n");
  const ourLines = ours.split("\n");
  const theirLines = theirs.split("\n");

  const merged: string[] = [];
  const conflicts: ConflictRegion[] = [];
  const maxLen = Math.max(baseLines.length, ourLines.length, theirLines.length);

  for (let i = 0; i < maxLen; i++) {
    const baseLine = baseLines[i] ?? "";
    const ourLine = ourLines[i] ?? "";
    const theirLine = theirLines[i] ?? "";

    if (ourLine === theirLine) {
      // Both agree
      merged.push(ourLine);
    } else if (ourLine === baseLine) {
      // Only theirs changed
      merged.push(theirLine);
    } else if (theirLine === baseLine) {
      // Only ours changed
      merged.push(ourLine);
    } else {
      // Both changed differently — conflict
      conflicts.push({
        startLine: i,
        endLine: i,
        ours: ourLine,
        theirs: theirLine,
        base: baseLine,
      });
      // Take theirs by default, mark as conflict
      merged.push(theirLine);
    }
  }

  return {
    merged: merged.join("\n"),
    hasConflicts: conflicts.length > 0,
    conflicts,
  };
}
