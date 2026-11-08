# Folders and the tree

Folders are first-class: users can drop or pick whole folders, several at once and mixed with loose files. Every file keeps its relative path, empty folders are kept, and your backend can receive the whole structure as a manifest.

## Accepting folders

Folders are on by default (`folders: true`). In the UI there is a "Select folder" button where the browser supports it, and a drop of a folder onto the zone adds all its files.

```js
const ad = new AnyDrop('#uploader', {
  url: '/upload',
  folders: true, // default
  folderView: 'tree', // or 'flat'
});
```

With `folders: false`, dropped folders are skipped.

| Browser | Folder drop | Folder picker |
|---|---|---|
| Chrome, Edge, Firefox, Safari (desktop) | yes | yes |
| Safari on iOS and iPadOS | no | no (a notice is shown) |
| Chrome on Android | n/a | where the browser offers it |

AnyDrop detects the folder picker by feature (`'webkitdirectory' in input`), never by user agent. See [Mobile and iOS](/guide/mobile-ios).

## The tree

`getTree()` returns the virtual root. Each [`FolderNode`](/api/types#foldernode) has `path`, `name`, `parent`, `children`, `files`, a rolled-up `status`, `progress`, byte totals and per-status `counts`.

```js
function print(folder, indent = '') {
  console.log(indent + (folder.name || '(root)'), Math.round(folder.progress) + '%', folder.status);
  folder.children.forEach((child) => print(child, indent + '  '));
}
print(ad.getTree());
```

Folders are unique by path, so dropping `Photos` twice merges into one node. A node's status and progress are updated incrementally as files change, so a tree with thousands of files stays cheap.

You can also add a file to a folder yourself:

```js
ad.addFile(someFile, 'Photos/2024'); // someFile is a File you already have
```

## Empty folders

Empty folders are kept (`preserveEmptyFolders`, default `true`). A folder whose only files were ignored hidden files, such as `.gitkeep`, counts as empty. The `emptyfolder` event fires for a dropped directory that has no entries at all.

::: warning
Browsers do not report empty folders through `<input webkitdirectory>`, only through drops. Empty folders reach the server **only through the manifest**.
:::

## The manifest

With `sendManifest: true` and a `manifestUrl`, AnyDrop sends one JSON request per batch, right before the batch's first file:

```js
new AnyDrop('#uploader', {
  url: '/upload',
  sendManifest: true,
  manifestUrl: '/upload/manifest',
});
```

The body lists the folders (including empty ones) and the files with their `uploadId`, path, size and type. Your server creates every folder and answers `200`. The files of the batch wait for the manifest; if it fails after its retries, they fail with `stage: 'manifest'`. See the [protocol](/protocol#_2-manifest-optional-sendmanifest-true-sent-before-any-file) for the exact shape.

## Folder events

```js
ad.on('addedfolder', (folder) => console.log('new folder', folder.path));
ad.on('folderprogress', (folder, percent) => console.log(folder.path, Math.round(percent)));
ad.on('foldercomplete', (folder) => console.log('folder finished', folder.path));
ad.on('removedfolder', (folder) => console.log('folder removed', folder.path));
```

`folderprogress` fires for every ancestor folder of a file that made progress (not the root), at most once per folder per 100 ms. `foldercomplete` fires innermost folder first, and can fire again after a retry.

## Folder actions

```js
ad.pauseFolder('Photos/2024');
ad.resumeFolder('Photos/2024');
ad.cancelFolder('Photos/2024');
ad.retryFailedOnly('Photos/2024'); // only the failed files of that folder
```

## Ignoring hidden files

Files whose name starts with `.` are skipped inside dropped or picked folders (`ignoreHiddenFiles`, default `true`). Loose files and hidden folders are not skipped, as in Dropzone.
