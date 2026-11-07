---
'@vedratech/anydrop-ui': minor
---

Connection banner and outage handling. While the browser is offline or the server cannot be reached, a banner above the toolbar shows the state, a countdown to the next attempt and a "Retry now" button (it calls the core's `reconnect()`); files held only by the connection show "Waiting for connection" instead of "Paused". New texts: `dictOffline`, `dictReconnecting` (`{{seconds}}`), `dictRetryNow`, `dictConnectionRestored`, `dictWaitingForConnection`. The Pause buttons on rows, folders and the toolbar now stay available during an outage, and a pause made then survives the reconnect. Fix: pausing or resuming a folder repaints the rows of its files at once.
