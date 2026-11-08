---
'@vedratech/anydrop-ui': patch
---

A plain-object `transport` passed to the constructor (or through `AnyDrop.options`) is now used as is instead of being copied, so a transport that keeps state works the same as a class instance.
