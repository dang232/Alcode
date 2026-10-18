/**
 * Native team member operations: member extension set assembly.
 *
 * A member session boots with the member extension entry plus whatever
 * provider extensions it inherited, deduplicated with the entry first.
 */
export function assembleMemberExtensions(
  entryPath: string,
  inheritedExtensions: readonly string[] = [],
): readonly string[] {
  return [...new Set([entryPath, ...inheritedExtensions])]
}
