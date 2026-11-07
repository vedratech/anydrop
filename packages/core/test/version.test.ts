import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index';
import pkg from '../package.json';

describe('VERSION', () => {
  it('is a semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });

  it('matches package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });
});
