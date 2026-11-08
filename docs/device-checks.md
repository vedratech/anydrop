---
title: "Real-device checks for iPhone and Android"
description: "The checklist used to verify AnyDrop on real iPhone and Android phones: folder limits, background tabs, large files, offline recovery and what has been tested."
---

# Real-device checks (iPhone and Android)

Playwright's WebKit is **not** iOS Safari and its Pixel is a desktop Chromium with a phone viewport. This checklist is what only a real phone can prove. It covers every mobile and iOS item that emulation cannot show: background suspension, the WebKit behaviour of aborted chunks, and network loss.

Run it on **a real iPhone in Safari** (latest two iOS versions if you have them, record the versions) and **an Android phone in Chrome**. Write the result next to each step (PASS, FAIL, N/A plus one line). Anything that fails: note the steps, the phone, the OS version and, if you can, the output of `http://<laptop-ip>:3001/__log` (see below), and report it to the maintainers.

## 0. Setup: reach the dev server from the phone

You need the laptop and the phone on the **same Wi-Fi** (not a guest network with client isolation).

1. Build once so the demo has the packages: `pnpm build`.
2. Find the laptop's LAN address: Windows `ipconfig` (the "IPv4 Address" of the Wi-Fi adapter, for example `192.168.1.23`); macOS `ipconfig getifaddr en0`; Linux `hostname -I`.
3. Start the mock server (it listens on all interfaces) and the demo (Vite is configured with `host: true`):
   ```bash
   pnpm dev:mock      # http://<laptop-ip>:3001
   pnpm dev:demo      # http://<laptop-ip>:5173
   ```
4. **Allow both ports in the laptop firewall** (Windows: "Allow an app" for Node.js on private networks, or `New-NetFirewallRule -DisplayName anydrop-dev -Direction Inbound -Protocol TCP -LocalPort 3001,5173 -Action Allow`).
5. On the phone open `http://<laptop-ip>:5173/?mock=http://<laptop-ip>:3001`.
   The `?mock=` part is required: without it the demo talks to `localhost:3001`, which on the phone is the phone itself. The page header shows the mock URL it uses.
6. Check that it works: pick a small file in the "Basic" example and see the success mark. Then on the laptop open `http://localhost:3001/__report` (what the server received) and `http://localhost:3001/__log` (every request, with status, upload id and chunk index).
7. Useful laptop commands while testing (PowerShell shown, `curl` works the same elsewhere):
   ```powershell
   curl.exe -X POST http://localhost:3001/__config -H "Content-Type: application/json" -d '{"latencyMs":400}'   # slow server
   curl.exe -X POST http://localhost:3001/__config -H "Content-Type: application/json" -d '{"failRate":0}'       # heal
   curl.exe -X POST "http://localhost:3001/__reset"                                                              # forget uploads
   ```
   The demo also has buttons: "Slow server (300 ms)" under the tree example, and "Make the server fail" / "Heal the server" under "Errors and retry".
8. Notes about the plain `http://` LAN page: it is not a secure context. If anything breaks that works on `localhost`, write it down: it matters for users on http intranets.
9. To see the console: Android: USB debugging and `chrome://inspect` on the laptop. iOS: Settings, Safari, Advanced, Web Inspector, then Safari on a Mac, Develop menu. Without a Mac, rely on the demo's visible state and the mock server log.

Test data: put on the phone (AirDrop, USB or cloud) a few photos including **HEIC** (iPhone camera default), one **video of 1 GB or more** (or the largest you have), and a folder of about 200 small files on the Android phone (a downloaded or copied folder).

## 1. Capability detection

| # | Step | Expected | iPhone | Android |
|---|---|---|---|---|
| 1.1 | Open the **Folder tree** example. | On iPhone/iPadOS Safari **there is no "Select folder" button** (no `webkitdirectory`), and a short notice explains that files, not folders, are selected (`dictNoFolderSupport`). On Android Chrome the folder button **is** shown. | | |
| 1.2 | Look at the drop zone. | Touch layout: one full-width **"Tap to upload"** button, no "drop here" text. | | |
| 1.3 | Tap it. | The system file chooser (iOS: Photo Library / Take Photo or Video / Choose Files; Android: Documents or Gallery). | | |
| 1.4 | Android only: tap "Select folder", pick a folder of about 200 files. | The tree shows the folder, subfolders and files, and uploads. Empty subfolders are **not** reported by the picker (expected). Compare on the laptop: `http://localhost:3001/__report`. | N/A | |

## 2. Input and formats

| # | Step | Expected | iPhone | Android |
|---|---|---|---|---|
| 2.1 | In the **Mobile** example (accepts `image/*,.heic,.heif,.pdf`) choose a **HEIC** photo from the library. | Accepted (not "You can't upload files of this type"), thumbnail shown or the generic icon without an error, upload succeeds, the server has a `.heic` file of the same size. Note that iOS may convert HEIC to JPEG when you pick from "Photo Library" and keeps HEIC from "Choose Files": try both and write which you got. | | |
| 2.2 | Same example, pick a **PDF** and a **.txt** file. | The PDF is accepted, the `.txt` is rejected with the dictionary message. | | |
| 2.3 | If the app sets `capture` (add `capture: 'environment'` in the demo or the console): tap upload. | The camera opens. (Skip if the demo does not expose it; record N/A.) | | |
| 2.4 | **iCloud placeholder (iPhone):** in Files, find a file marked with the cloud icon (not downloaded), pick it. | A clear error for that file, **not a hang**. | | N/A |
| 2.5 | Pick a **zero-byte** file (create one in a file manager or via a note app that can export an empty file). | Uploads as an empty file or is rejected with a message; no hang. | | |
| 2.6 | Pick **20 large photos at once** (several MB each) in the Mobile example. | Thumbnails appear lazily, the page stays responsive and does not reload or "A problem occurred with this webpage" (iOS memory pressure). | | |

## 3. Large files and the Blob.slice question

Playwright's WebKit build posts an **empty body** for `Blob.slice()` of a file chosen through `<input type=file>` (reproduced without AnyDrop, see `e2e/tests/large-file.spec.ts`). We do not know whether real iOS Safari does the same, so this check matters a lot for iPhone.

**Also look at the server log in sections 3 and 7.** Open `http://localhost:3001/__log` (or watch the terminal of `pnpm dev:mock`) and search for **`400` with `INVALID_CHUNK` and "length 0"** (a chunk that arrived with an empty body; the log line carries `bytes: 0`, the error message says `length 0 do not match`). An upload that shows such an error, on a real iPhone or Mac Safari, **reproduces WEBKIT-FLAKE-1 and becomes a 0.1.0 blocker**. Write down the step, the file and how many times it happened, even if the file ended up complete after "Retry failed".

| # | Step | Expected | iPhone | Android |
|---|---|---|---|---|
| 3.1 | In the **Folder tree** example (64 KB chunks) pick **one file of about 5 to 20 MB** (a photo burst, a short video). | Uploads in many chunks. On the laptop `__report` shows the file with the **same size** and, for a known file, the same SHA-256 (`certutil -hashfile <file> SHA256` on the original vs `__report`). **FAIL if the file size is 0 or the chunks are empty.** | | |
| 3.2 | Pick the **1 GB or larger video**. In the console run `anydrop.tree.setOption('chunkSize', 8*1024*1024)` first if you can (Android with remote debugging), otherwise use the default 64 KB chunks and expect a slow but steady upload. | Memory stays flat (the tab does not reload), progress moves, the upload finishes or can be paused and resumed. Write the time and whether the tab survived. | | |
| 3.3 | While 3.2 runs, switch to another app for 10 seconds and come back. | See section 4. | | |

## 4. Background suspension (unverified)

This is the main unknown: **how does an in-flight XHR fail on iOS when the tab goes to the background or the screen locks?** Possible outcomes: an `error` event, a `timeout`, or nothing at all (a hang until the page returns). Record exactly what you see.

Preparation: start the slow server (`latencyMs: 400`) and upload a 20 MB or larger file (or the folder of 200 files on Android) in the Folder tree example, so that many chunks are in flight for a minute or more.

| # | Step | Expected | iPhone | Android |
|---|---|---|---|---|
| 4.1 | While uploading press the **side button** to lock the screen, wait **30 seconds**, unlock. | The upload **pauses cleanly** (no error entries) and **resumes by itself** when the page is visible again, or continues if the OS kept it running. No chunk is lost: at the end the tree on the laptop equals the source. | | |
| 4.2 | **Write down** the laptop `__log` during the lock: did requests keep arriving while locked, did they stop, did they fail? | (A record, not a pass or fail.) Tell the maintainers which of "error", "timeout", "hang" you saw. If it **hung** until unlock, a rule will be added (abort and resend requests that made no progress while hidden). | | |
| 4.3 | Switch to **another app** for **2 minutes**, come back. | Same as 4.1. The banner or row state says "Waiting for connection" or "Paused" while away only if the library noticed; after return it resumes. | | |
| 4.4 | Press **Home**, wait **10 minutes**, return (the OS may reload the tab). | If the tab reloaded: pick the same files again; **finished files and chunks are skipped** (laptop `__log` shows no repeated chunks, the status endpoint is asked). If it did not reload: the upload continues. | | |
| 4.5 | Open another tab (Safari tab switcher), come back after 30 seconds. | Same as 4.1. | | |
| 4.6 | Swipe the page away (close the tab), reopen the demo, pick the same files. | Resume skips finished work (IndexedDB survived). | | |
| 4.7 | **Safari Private Browsing** (iPhone): repeat a small upload, then reload mid-upload. | The upload works. Persistence may be unavailable (IndexedDB can throw): that must **not** break the upload. After reload nothing is skipped, which is acceptable. | | N/A (use an Incognito tab) |

## 5. A paused chunk committed twice

In Playwright's WebKit, aborting an XHR whose body was already sent does not stop the server from committing it, so a paused chunk can be written twice (harmless but wasteful). Check whether **real iPhone Safari** does it.

| # | Step | Expected | iPhone | Android |
|---|---|---|---|---|
| 5.1 | Slow server (`latencyMs: 400`). Upload one 20 MB file in the Folder tree example (64 KB chunks), press **Pause** on its row after a few chunks, wait 5 seconds, press **Resume**. | The upload completes and the file matches. | | |
| 5.2 | Then on the laptop open `http://localhost:3001/__report` and look at that upload's `duplicateChunkWrites`. | **0** on Android. On iPhone **write the number**: any value above 0 confirms the WebKit behaviour on real devices (allowed, not a failure; the file is still correct). | | |

## 6. Touch, layout and accessibility

| # | Step | Expected | iPhone | Android |
|---|---|---|---|---|
| 6.1 | Rotate to landscape and back, in every demo example. | No horizontal scroll, nothing hidden behind the notch or home indicator (safe areas respected). | | |
| 6.2 | Tap every button in a tree row (pause, resume, cancel, caret) with a thumb. | Each is easy to hit (at least 44 by 44 px), no accidental taps. | | |
| 6.3 | Scroll the tree list with a finger, with 200 files (Android) or 100 photos (iPhone, drop 100 images in the Mobile example). | Scrolling does not trigger a button; it is smooth. | | |
| 6.4 | Tap into any text input the demo has. | The page does **not zoom** on focus (input text at least 16 px). Record N/A if the demo has no text input. | | N/A |
| 6.5 | **VoiceOver** (iPhone, triple-click the side button) / **TalkBack** (Android): upload a file. | Progress and errors are announced; rows and buttons have names (for example "Pause", "Cancel upload"). The connection banner text is announced when the state changes, and **not on every countdown second**. | | |
| 6.6 | Dark mode on, then off. | The UI follows the system theme and stays readable. | | |
| 6.7 | Android mid-range phone: drop or pick a folder with about **5,000 small files** if you have one (or run `anydrop.tree.addFiles` with 5,000 generated files from the console). | The tree scrolls smoothly (about 60 fps), no jank or crash. | N/A | |

## 7. Network loss

**Search `__log` for `400` `INVALID_CHUNK` with "length 0" after every step of this section** (see section 3: an empty chunk body is a blocker).

Keep the laptop as the server. Start with the slow server (`latencyMs: 300`) and a folder or large file that takes a minute or more to upload. After each step the final check is the same: **the tree on the laptop equals the source, no entry in the error list caused by the network, and no chunk the server already held is sent again** (look at `__log`; one repeat per request that was in flight at the moment of the cut is acceptable, and WebKit may repeat an aborted chunk, see section 5).

| # | Step | Expected | iPhone | Android |
|---|---|---|---|---|
| 7.1 | **Airplane mode on** mid-upload, wait 20 seconds, **airplane mode off**. | The banner says you are offline and rows say "Waiting for connection"; nothing is sent; when the link is back the upload resumes by itself within a few seconds (Wi-Fi reconnects, which can take up to 10 to 20 s). | | |
| 7.2 | **Wi-Fi to cellular:** mid-upload switch the phone's Wi-Fi off (cellular on). The laptop is on the LAN, so the phone can no longer reach it: that is a real outage from the page's view. After 30 seconds switch Wi-Fi back on. | `navigator.onLine` may stay true (cellular is up): the banner should show **"Connection lost. Retrying in N s"** with a countdown and a "Retry now" button (the "unreachable" state), **no error entries**. When Wi-Fi is back the next probe succeeds, the banner hides and the upload resumes. | | |
| 7.3 | In 7.2, press **Retry now** several times while Wi-Fi is still off. | Each press probes at once; nothing fails; no file ends in the error list. | | |
| 7.4 | **Lock the screen for 2 minutes** mid-upload (see also section 4), unlock. | Resumes cleanly; no file in error; the countdown does not show a stale value after unlock. | | |
| 7.5 | **Captive portal** (only if you have one: hotel or airport Wi-Fi, a router with the WAN unplugged, a hotspot with no data). A LAN laptop cannot play the server here, so expose the mock server through a public tunnel (for example `cloudflared` or `ngrok`) and open `?mock=https://<tunnel-host>`; then join the captive Wi-Fi. | The state becomes "Connection lost" after about 3 failed requests; **no error entries**; after you sign in to the portal the upload resumes. Note what the portal returns: an HTML 200 page counts as a server response, not an outage, so the upload may report a protocol error instead. That is expected and worth recording. | | |
| 7.6 | **Slow link:** limit the phone's data (Android: developer options "Network speed limit" or a throttled hotspot; iPhone: Network Link Conditioner on a Mac-tethered phone, if available). Upload a 20 MB file. | Progress keeps moving with 8 MB chunks; a request is not wrongly aborted as stalled while bytes are still being sent (the stall timeout is 30 s of **no progress**). Record the link speed and whether any "STALLED" error appears. | | |
| 7.7 | Stop the dev server (`Ctrl+C` in `pnpm dev:mock`) for 30 seconds mid-upload, then start it again with `pnpm dev:mock`. | Same as 7.2: the banner shows "Connection lost", no errors; after the restart the upload resumes. Note that the mock keeps uploads in memory, so after a restart it forgets the chunks it held; the file may restart from chunk 0 and still arrive correct. | | |

## 8. Record

| | iPhone | Android |
|---|---|---|
| Device and model | | |
| OS version | | |
| Browser and version | | |
| Date | | |
| Tester | | |
| Failures (step numbers) | | |
| Section 4 outcome: what did a request do while the screen was locked? (error / timeout / hang / kept running) | | |
| Section 5: `duplicateChunkWrites` | | |
| Section 3: did `Blob.slice` of a picked file upload correct bytes? | | |
| Sections 3 and 7: any `400 INVALID_CHUNK` with length 0 in `__log`? (how many, which step) | | |

Send the filled table to the maintainers. It is the record that real-device checks on an iPhone and an Android phone were done.
