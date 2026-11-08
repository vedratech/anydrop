---
layout: home
title: "AnyDrop: folder upload, chunked and resumable uploads for the browser"
titleTemplate: false
description: "Folder upload for the browser in JavaScript: drag and drop folders, chunked and resumable uploads, pause and resume, retry, mobile. TypeScript, MIT."

hero:
  name: AnyDrop
  text: Folder upload for the browser
  tagline: Drag and drop folders, chunked and resumable uploads, pause and resume, and recovery from a bad connection. A JavaScript and TypeScript library that works on phones.
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
      alt: Folder icon
      width: 48
      height: 48
    title: Folders and a tree view
    details: Drop or pick whole folders, mixed with loose files. Every file keeps its path, empty folders are kept, and your backend can get the structure as a manifest.
    link: /guide/folders
    linkText: Folders and the tree
  - icon:
      src: /icons/chunks.svg
      alt: Chunks icon
      width: 48
      height: 48
    title: Chunked uploads
    details: Big files are sent in pieces with Blob.slice(), so a file is never loaded into memory. Retries with backoff, parallel chunks.
    link: /guide/chunked-uploads
    linkText: Chunked uploads
  - icon:
      src: /icons/pause.svg
      alt: Pause icon
      width: 48
      height: 48
    title: Pause, resume, and resume after reload
    details: Pause everything, one folder or one file. Close the tab and drop the same files again later, and only the missing chunks are sent.
    link: /guide/pause-resume
    linkText: Pause and resume
  - icon:
      src: /icons/offline.svg
      alt: Offline icon
      width: 48
      height: 48
    title: Offline and bad connections
    details: Uploads pause by themselves when the browser is offline, the tab is hidden or the server cannot be reached, and carry on when it returns.
    link: /guide/offline
    linkText: Offline and connectivity
  - icon:
      src: /icons/errors.svg
      alt: Error list icon
      width: 48
      height: 48
    title: A persistent error list with retry
    details: One reason per failed file. Retry only the failures (all, or one folder) and export the list as JSON or CSV.
    link: /guide/errors-retry
    linkText: Errors and retry
  - icon:
      src: /icons/mobile.svg
      alt: Phone icon
      width: 48
      height: 48
    title: Mobile and iOS
    details: Tap-to-upload layout, 44 px targets, safe areas, capped thumbnails, HEIC photos recognised. Where iOS has no folder picker, AnyDrop says so.
    link: /guide/mobile-ios
    linkText: Mobile and iOS
---

<div class="home-note">

AnyDrop is a **JavaScript folder upload** library: users can **drag and drop** whole folders or pick them, and your page uploads them with **chunked, resumable uploads**, **pause and resume**, retry and a persistent error list. It is configured with plain options and events. There is no server to install: your backend implements a [small HTTP contract](/backend/).

AnyDrop ships two packages: [`@vedratech/anydrop-core`](/guide/headless-core), the headless engine with no dependencies, and [`@vedratech/anydrop-ui`](/guide/quick-start), the drop zone, folder tree and mobile layout on top of it. Download size, measured the same way for every library: [AnyDrop ui + core 34.7 kB gzip, FilePond 40.5 kB, Uppy with Dashboard 78.4 kB](/size-comparison).

</div>

## Use cases

- [Upload a folder in JavaScript](/use-cases/upload-folder-javascript): drag and drop and a folder picker, with paths and empty folders.
- [Chunked and resumable file uploads](/use-cases/chunked-resumable-uploads) in the browser.
- [Upload large files (1 GB and more)](/use-cases/upload-large-files) without loading them into memory.
- [Pause and resume uploads](/use-cases/pause-resume-uploads): everything, a folder or one file.
- [File upload that survives a lost connection](/use-cases/upload-lost-connection).
- [Folder upload with React, Angular and Vue](/use-cases/folder-upload-react-angular-vue): wrappers are planned, not shipped yet.
- [Laravel and Express chunked upload backend](/use-cases/chunked-upload-backend).
