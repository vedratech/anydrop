---
layout: home
title: AnyDrop
titleTemplate: Folder-first uploads for the browser

hero:
  name: AnyDrop
  text: Folder-first uploads, configured like Dropzone
  tagline: Drop whole folders, upload large files in chunks, pause and resume, survive a bad connection. Plain JavaScript, works on phones.
  actions:
    - theme: brand
      text: Get started
      link: /guide/introduction
    - theme: alt
      text: Try the demo
      link: /demo
    - theme: alt
      text: API reference
      link: /api/

features:
  - icon:
      src: /icons/folder.svg
    title: Folders and a tree view
    details: Drop or pick whole folders, mixed with loose files. Every file keeps its path, empty folders are kept, and your backend can get the structure as a manifest.
    link: /guide/folders
    linkText: Folders and the tree
  - icon:
      src: /icons/chunks.svg
    title: Chunked uploads
    details: Big files are sent in pieces with Blob.slice(), so a file is never loaded into memory. Dropzone's field names, retries with backoff, parallel chunks.
    link: /guide/chunked-uploads
    linkText: Chunked uploads
  - icon:
      src: /icons/pause.svg
    title: Pause, resume, and resume after reload
    details: Pause everything, one folder or one file. Close the tab and drop the same files again later, and only the missing chunks are sent.
    link: /guide/pause-resume
    linkText: Pause and resume
  - icon:
      src: /icons/offline.svg
    title: Offline and bad connections
    details: Uploads pause by themselves when the browser is offline, the tab is hidden or the server cannot be reached, and carry on when it returns.
    link: /guide/offline
    linkText: Offline and connectivity
  - icon:
      src: /icons/errors.svg
    title: A persistent error list with retry
    details: One reason per failed file. Retry only the failures (all, or one folder) and export the list as JSON or CSV.
    link: /guide/errors-retry
    linkText: Errors and retry
  - icon:
      src: /icons/mobile.svg
    title: Mobile and iOS
    details: Tap-to-upload layout, 44 px targets, safe areas, capped thumbnails, HEIC photos recognised. Where iOS has no folder picker, AnyDrop says so.
    link: /guide/mobile-ios
    linkText: Mobile and iOS
---

<div class="home-note">

AnyDrop ships two packages: [`@vedratech/anydrop-core`](/guide/headless-core), the headless engine with no dependencies, and [`@vedratech/anydrop-ui`](/guide/quick-start), the drop zone, folder tree and mobile layout on top of it. There is no server to install: your backend implements a [small HTTP contract](/backend/).

</div>
