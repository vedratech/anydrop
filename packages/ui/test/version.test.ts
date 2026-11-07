import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index';
import { VERSION as CORE_VERSION } from '@vedratech/anydrop-core';

describe('ui re-exports', () => {
  it('re-exports VERSION from core', () => {
    expect(VERSION).toBe(CORE_VERSION);
  });
});
