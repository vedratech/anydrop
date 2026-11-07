export interface TreeFile {
  path: string;
  size: number;
  sha256?: string;
}
export interface Tree {
  files: TreeFile[];
  folders: string[];
}
export function makeRng(seed: number): {
  next(): number;
  int(min: number, max: number): number;
  bytes(n: number): Buffer;
};
export function sha256File(path: string): Promise<string>;
export function walkTree(root: string, opts?: { hash?: boolean }): Promise<Tree>;
export function diffTrees(expected: Tree, actual: Tree, opts?: { prefix?: string }): string[];
