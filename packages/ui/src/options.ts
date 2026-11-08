// UI options and their defaults.
import type { AnyDropCoreOptions, AnyDropEventHandlers } from '@vedratech/anydrop-core';
import type { AnyDrop } from './AnyDrop';

export type ElementRef = string | HTMLElement;

/** The DOM strings of a UI instance. Every user-visible text is one of these (translatable). */
export interface AnyDropDict {
  /** Text of the drop zone. Default `Drop files here to upload`. */
  dictDefaultMessage: string;
  /** Shown when the browser lacks drag and drop. Default `Your browser does not support drag'n'drop file uploads.` */
  dictFallbackMessage: string;
  /** Shown above the fallback form. */
  dictFallbackText: string;
  /** Button of the fallback form. Default `Upload!`. */
  dictFallbackUpload: string;
  /** Link text while uploading (with `addRemoveLinks`). Default `Cancel upload`. */
  dictCancelUpload: string;
  /** Question before canceling an upload. */
  dictCancelUploadConfirmation: string;
  /** Link text of a finished file (with `addRemoveLinks`). Default `Remove file`. */
  dictRemoveFile: string;
  /** Screen-reader text and tooltip when a thumbnail cannot be loaded. */
  dictThumbnailError: string;
  /** Shown where folders cannot be selected (for example iOS). */
  dictNoFolderSupport: string;
  /** Label of the file picker button. Default `Select files`. */
  dictSelectFiles: string;
  /** Label of the folder picker button. Default `Select folder`. */
  dictSelectFolder: string;
  /** Label of the file button on touch devices. */
  dictTapToUpload: string;
  /** Toolbar button. Default `Pause all`. */
  dictPauseAll: string;
  /** Toolbar button. Default `Resume all`. */
  dictResumeAll: string;
  /** Toolbar and error panel button. Default `Retry failed`. */
  dictRetryFailed: string;
  /** Toolbar button that removes the finished files. Default `Clear`. */
  dictClear: string;
  /** Row button. Default `Pause`. */
  dictPause: string;
  /** Row button. Default `Resume`. */
  dictResume: string;
  /** Row button. Default `Retry`. */
  dictRetry: string;
  /** Accessible name of the folder toggle when closed. Default `Expand folder`. */
  dictExpand: string;
  /** Accessible name of the folder toggle when open. Default `Collapse folder`. */
  dictCollapse: string;
  /** Row status. Default `Added`. */
  dictStatusAdded: string;
  /** Row status. Default `Queued`. */
  dictStatusQueued: string;
  /** Row status. Default `Uploading`. */
  dictStatusUploading: string;
  /** Row status. Default `Paused`. */
  dictStatusPaused: string;
  /** Row status. Default `Done`. */
  dictStatusSuccess: string;
  /** Row status. Default `Failed`. */
  dictStatusError: string;
  /** Row status. Default `Canceled`. */
  dictStatusCanceled: string;
  /** `{{done}}`, `{{total}}`, `{{failed}}`. */
  dictSummary: string;
  /** `{{done}}`, `{{total}}`. */
  dictFolderCount: string;
  /** `{{count}}`. */
  dictErrorsTitle: string;
  /** Error panel button. Default `Export JSON`. */
  dictExportJson: string;
  /** Error panel button. Default `Export CSV`. */
  dictExportCsv: string;
  /** Error panel button. Default `Copy list`. */
  dictCopyErrors: string;
  /** Message after the error list was copied. */
  dictCopied: string;
  /** Message when copying failed. */
  dictCopyFailed: string;
  /** Error panel button. Default `Dismiss list`. */
  dictDismissErrors: string;
  /** Accessible name of the drop zone. Default `File upload`. */
  dictRegionLabel: string;
  /** Accessible name of the list. Default `Files to upload`. */
  dictListLabel: string;
  /** Accessible name of the toolbar. Default `Upload actions`. */
  dictToolbarLabel: string;
  /** `{{count}}`. */
  dictAnnounceAdded: string;
  /** Screen-reader message when all uploads finished. Default `Upload complete.` */
  dictAnnounceComplete: string;
  /** `{{count}}`. */
  dictAnnounceErrors: string;
  /** `{{percent}}`. */
  dictAnnounceProgress: string;
  /** Banner while the browser is offline. */
  dictOffline: string;
  /** Banner while the server cannot be reached; `{{seconds}}` counts down to the next attempt. */
  dictReconnecting: string;
  /** Connection banner button; calls `reconnect()`. Default `Retry now`. */
  dictRetryNow: string;
  /** Announced when the connection banner hides. Default `Connection restored`. */
  dictConnectionRestored: string;
  /** Row status of a file that waits for the connection (paused by the system, not by the user). */
  dictWaitingForConnection: string;
  /** Screen-reader message. Default `Upload paused.` */
  dictAnnouncePaused: string;
  /** Screen-reader message. Default `Upload resumed.` */
  dictAnnounceResumed: string;
}

export interface AnyDropUIOptions extends AnyDropDict {
  /** `true` = the element itself, `false` = none, or a selector, element or list of them. */
  clickable: boolean | ElementRef | ElementRef[];
  /** Where the list, toolbar and error panel go. `null` = inside the element. */
  previewsContainer: ElementRef | null | false;
  /** Markup of one file preview (the `data-ad-*` hooks are filled in). */
  previewTemplate: string;
  /** Where the hidden file inputs are placed. Default `'body'`. */
  hiddenInputContainer: ElementRef;
  /** Add a "Remove file" / "Cancel upload" link to each preview. Default `false`. */
  addRemoveLinks: boolean;
  /** Question asked before removing a finished file (`null` = no question). */
  dictRemoveFileConfirmation: string | null;
  /** Passed to the file input (`'environment'`, `'user'`, ...). */
  capture: string | null;
  /** Create thumbnails for images. Default `true`. */
  createImageThumbnails: boolean;
  /** MiB; larger images get no thumbnail. */
  maxThumbnailFilesize: number;
  /** Thumbnail width in px, capped at 512. Default `120`. */
  thumbnailWidth: number | null;
  /** Thumbnail height in px, capped at 512. Default `120`. */
  thumbnailHeight: number | null;
  /** `'crop'` or `'contain'`. Default `'crop'`. */
  thumbnailMethod: 'crop' | 'contain';
  /** Scale images down to this width in px before upload. Default `null`. */
  resizeWidth: number | null;
  /** Scale images down to this height in px before upload. Default `null`. */
  resizeHeight: number | null;
  /** MIME type of the resized image (`null` = keep the type). Default `null`. */
  resizeMimeType: string | null;
  /** Encoder quality from 0 to 1. Default `0.8`. */
  resizeQuality: number;
  /** `'contain'` or `'crop'`. Default `'contain'`. */
  resizeMethod: 'crop' | 'contain';
  /** Render no list, toolbar or error panel (render everything yourself). Default `false`. */
  disablePreviews: boolean;
  /** Show the fallback form even when the browser supports everything. Default `false`. */
  forceFallback: boolean;
  /** Runs when the browser lacks the needed APIs, or with `forceFallback`. `null` = the default form. */
  fallback: ((this: AnyDrop) => void) | null;
  /** Called once at the end of the constructor. */
  init: ((this: AnyDrop) => void) | null;
  // New in AnyDrop
  /** `'tree'` (collapsible folders) or `'flat'` (files with their full path). Default `'tree'`. */
  folderView: 'tree' | 'flat';
  /** Row height in px of the virtualized list. */
  rowHeight: number;
  /** Show the toolbar. Default `true`. */
  toolbar: boolean;
  /** Show the error panel when files failed. Default `true`. */
  errorPanel: boolean;
  /** The "Select files" and "Select folder" buttons. */
  pickerButtons: boolean;
  /** Add files pasted into the element. Off by default. */
  enablePaste: boolean;
  /** `'auto'` (follows `prefers-color-scheme`), `'light'` or `'dark'`. Default `'auto'`. */
  theme: 'auto' | 'light' | 'dark';
}

export type AnyDropFullOptions = AnyDropCoreOptions<AnyDrop> &
  AnyDropUIOptions &
  AnyDropEventHandlers<AnyDrop>;

/** What the constructor and `setOption` accept. */
export type AnyDropConfig = Partial<AnyDropCoreOptions<AnyDrop> & AnyDropUIOptions> &
  AnyDropEventHandlers<AnyDrop>;

const MARK =
  '<svg width="54" height="54" viewBox="0 0 54 54" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M10 30l4-4a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 0 1.4 0L38.3 15.7a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1.4L22.7 42.3a1 1 0 0 1-1.4 0L10.2 31.2a1 1 0 0 1-.2-1.2z"/></svg>';

const XMARK =
  '<svg width="54" height="54" viewBox="0 0 54 54" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M19 17l-2 2 8 8-8 8 2 2 8-8 8 8 2-2-8-8 8-8-2-2-8 8z"/></svg>';

/** The default preview template. `data-ad-*` attributes mark the parts that get filled in. */
export const DEFAULT_TEMPLATE =
  '<div class="ad-file-preview">' +
  '<div class="ad-file-thumb"><img data-ad-thumbnail draggable="false" alt="" /></div>' +
  '<div class="ad-file-details">' +
  '<div class="ad-file-size"><span data-ad-size></span></div>' +
  '<div class="ad-file-name"><span data-ad-name></span></div>' +
  '</div>' +
  '<div class="ad-file-progress"><span class="ad-file-bar" data-ad-uploadprogress></span></div>' +
  '<div class="ad-file-error-message"><span data-ad-errormessage></span></div>' +
  '<div class="ad-file-success-mark">' +
  MARK +
  '</div>' +
  '<div class="ad-file-error-mark">' +
  XMARK +
  '</div>' +
  '</div>';

/** The default UI options (a fresh object each call). */
export function uiDefaults(): AnyDropUIOptions {
  return {
    clickable: true,
    previewsContainer: null,
    previewTemplate: DEFAULT_TEMPLATE,
    hiddenInputContainer: 'body',
    addRemoveLinks: false,
    dictRemoveFileConfirmation: null,
    capture: null,
    createImageThumbnails: true,
    maxThumbnailFilesize: 10,
    thumbnailWidth: 120,
    thumbnailHeight: 120,
    thumbnailMethod: 'crop',
    resizeWidth: null,
    resizeHeight: null,
    resizeMimeType: null,
    resizeQuality: 0.8,
    resizeMethod: 'contain',
    disablePreviews: false,
    forceFallback: false,
    fallback: null,
    init: null,
    folderView: 'tree',
    rowHeight: 56,
    toolbar: true,
    errorPanel: true,
    pickerButtons: true,
    enablePaste: false,
    theme: 'auto',
    dictDefaultMessage: 'Drop files here to upload',
    dictFallbackMessage: "Your browser does not support drag'n'drop file uploads.",
    dictFallbackText:
      'Please use the fallback form below to upload your files like in the olden days.',
    dictFallbackUpload: 'Upload!',
    dictCancelUpload: 'Cancel upload',
    dictCancelUploadConfirmation: 'Are you sure you want to cancel this upload?',
    dictRemoveFile: 'Remove file',
    dictThumbnailError: 'Failed to load the image. The file may be corrupted.',
    dictNoFolderSupport:
      'This browser can only select files, not folders. Pick the files you need, or use a desktop browser to upload a whole folder.',
    dictSelectFiles: 'Select files',
    dictSelectFolder: 'Select folder',
    dictTapToUpload: 'Tap to upload',
    dictPauseAll: 'Pause all',
    dictResumeAll: 'Resume all',
    dictRetryFailed: 'Retry failed',
    dictClear: 'Clear',
    dictPause: 'Pause',
    dictResume: 'Resume',
    dictRetry: 'Retry',
    dictExpand: 'Expand folder',
    dictCollapse: 'Collapse folder',
    dictStatusAdded: 'Added',
    dictStatusQueued: 'Queued',
    dictStatusUploading: 'Uploading',
    dictStatusPaused: 'Paused',
    dictStatusSuccess: 'Done',
    dictStatusError: 'Failed',
    dictStatusCanceled: 'Canceled',
    dictSummary: '{{done}} of {{total}} uploaded, {{failed}} failed',
    dictFolderCount: '{{done}}/{{total}}',
    dictErrorsTitle: '{{count}} failed',
    dictExportJson: 'Export JSON',
    dictExportCsv: 'Export CSV',
    dictCopyErrors: 'Copy list',
    dictCopied: 'Copied to the clipboard.',
    dictCopyFailed: 'Could not copy the list.',
    dictDismissErrors: 'Dismiss list',
    dictRegionLabel: 'File upload',
    dictListLabel: 'Files to upload',
    dictToolbarLabel: 'Upload actions',
    dictAnnounceAdded: '{{count}} files added.',
    dictAnnounceComplete: 'Upload complete.',
    dictAnnounceErrors: '{{count}} files failed.',
    dictAnnounceProgress: 'Uploading, {{percent}} percent.',
    dictOffline: 'You are offline. Uploads will continue when you are back online.',
    dictReconnecting: 'Connection lost. Retrying in {{seconds}} s',
    dictRetryNow: 'Retry now',
    dictConnectionRestored: 'Connection restored',
    dictWaitingForConnection: 'Waiting for connection',
    dictAnnouncePaused: 'Upload paused.',
    dictAnnounceResumed: 'Upload resumed.',
  };
}
