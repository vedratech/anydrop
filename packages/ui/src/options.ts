// UI options. Dropzone options keep Dropzone 6.3.5's names and defaults (src/options.ts) unless noted.
import type { AnyDropCoreOptions, AnyDropEventHandlers } from '@vedratech/anydrop-core';
import type { AnyDrop } from './AnyDrop';

export type ElementRef = string | HTMLElement;

/** The DOM strings of a UI instance. Every user-visible text is one of these (translatable). */
export interface AnyDropDict {
  dictDefaultMessage: string;
  dictFallbackMessage: string;
  dictFallbackText: string;
  dictFallbackUpload: string;
  dictCancelUpload: string;
  dictCancelUploadConfirmation: string;
  dictRemoveFile: string;
  dictThumbnailError: string;
  /** Shown where folders cannot be selected (for example iOS). */
  dictNoFolderSupport: string;
  dictSelectFiles: string;
  dictSelectFolder: string;
  /** Label of the file button on touch devices. */
  dictTapToUpload: string;
  dictPauseAll: string;
  dictResumeAll: string;
  dictRetryFailed: string;
  dictClear: string;
  dictPause: string;
  dictResume: string;
  dictRetry: string;
  dictExpand: string;
  dictCollapse: string;
  dictStatusAdded: string;
  dictStatusQueued: string;
  dictStatusUploading: string;
  dictStatusPaused: string;
  dictStatusSuccess: string;
  dictStatusError: string;
  dictStatusCanceled: string;
  /** `{{done}}`, `{{total}}`, `{{failed}}`. */
  dictSummary: string;
  /** `{{done}}`, `{{total}}`. */
  dictFolderCount: string;
  /** `{{count}}`. */
  dictErrorsTitle: string;
  dictExportJson: string;
  dictExportCsv: string;
  dictCopyErrors: string;
  dictCopied: string;
  dictCopyFailed: string;
  dictDismissErrors: string;
  dictRegionLabel: string;
  dictListLabel: string;
  dictToolbarLabel: string;
  /** `{{count}}`. */
  dictAnnounceAdded: string;
  dictAnnounceComplete: string;
  /** `{{count}}`. */
  dictAnnounceErrors: string;
  /** `{{percent}}`. */
  dictAnnounceProgress: string;
  /** Banner while the browser is offline. */
  dictOffline: string;
  /** Banner while the server cannot be reached; `{{seconds}}` counts down to the next attempt. */
  dictReconnecting: string;
  dictRetryNow: string;
  dictConnectionRestored: string;
  /** Row status of a file that waits for the connection (paused by the system, not by the user). */
  dictWaitingForConnection: string;
  dictAnnouncePaused: string;
  dictAnnounceResumed: string;
}

export interface AnyDropUIOptions extends AnyDropDict {
  /** `true` = the element itself, `false` = none, or a selector, element or list of them. */
  clickable: boolean | ElementRef | ElementRef[];
  /** Where the list, toolbar and error panel go. `null` = inside the element. */
  previewsContainer: ElementRef | null | false;
  /** Markup of one file preview (Dropzone's `data-dz-*` hooks are filled in). */
  previewTemplate: string;
  hiddenInputContainer: ElementRef;
  addRemoveLinks: boolean;
  /** Question asked before removing a finished file (`null` = no question), as in Dropzone. */
  dictRemoveFileConfirmation: string | null;
  /** Passed to the file input (`'environment'`, `'user'`, ...). */
  capture: string | null;
  createImageThumbnails: boolean;
  /** MiB; larger images get no thumbnail. */
  maxThumbnailFilesize: number;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  thumbnailMethod: 'crop' | 'contain';
  resizeWidth: number | null;
  resizeHeight: number | null;
  resizeMimeType: string | null;
  resizeQuality: number;
  resizeMethod: 'crop' | 'contain';
  disablePreviews: boolean;
  forceFallback: boolean;
  /** Runs when the browser lacks the needed APIs, or with `forceFallback`. `null` = the default form. */
  fallback: ((this: AnyDrop) => void) | null;
  /** Called once at the end of the constructor, like Dropzone's `init`. */
  init: ((this: AnyDrop) => void) | null;
  // New in AnyDrop
  folderView: 'tree' | 'flat';
  /** Row height in px of the virtualized list. */
  rowHeight: number;
  toolbar: boolean;
  errorPanel: boolean;
  /** The "Select files" and "Select folder" buttons. */
  pickerButtons: boolean;
  /** Add files pasted into the element. Off by default, as Dropzone 6.3.5 does not wire `paste` either. */
  enablePaste: boolean;
  theme: 'auto' | 'light' | 'dark';
}

export type AnyDropFullOptions = AnyDropCoreOptions<AnyDrop> &
  AnyDropUIOptions &
  AnyDropEventHandlers<AnyDrop>;

/** What the constructor and `setOption` accept. */
export type AnyDropConfig = Partial<AnyDropCoreOptions<AnyDrop> & AnyDropUIOptions> &
  AnyDropEventHandlers<AnyDrop> & {
    /** @deprecated Dropzone's old name of `acceptedFiles`. */
    acceptedMimeTypes?: string | null;
    /** @deprecated Dropzone's old `renameFile`: `(name, file) => newName`. */
    renameFilename?: ((this: AnyDrop, name: string, file: File) => string) | null;
  };

const MARK =
  '<svg width="54" height="54" viewBox="0 0 54 54" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M10 30l4-4a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 0 1.4 0L38.3 15.7a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1.4L22.7 42.3a1 1 0 0 1-1.4 0L10.2 31.2a1 1 0 0 1-.2-1.2z"/></svg>';

const XMARK =
  '<svg width="54" height="54" viewBox="0 0 54 54" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M19 17l-2 2 8 8-8 8 2 2 8-8 8 8 2-2-8-8 8-8-2-2-8 8z"/></svg>';

/** Dropzone 6.3.5's default preview template (same hooks and classes), plus our `ad-*` classes. */
export const DEFAULT_TEMPLATE =
  '<div class="dz-preview dz-file-preview ad-preview">' +
  '<div class="dz-image ad-thumb"><img data-dz-thumbnail draggable="false" alt="" /></div>' +
  '<div class="dz-details ad-details">' +
  '<div class="dz-size ad-size"><span data-dz-size></span></div>' +
  '<div class="dz-filename ad-name"><span data-dz-name></span></div>' +
  '</div>' +
  '<div class="dz-progress ad-progress"><span class="dz-upload ad-bar" data-dz-uploadprogress></span></div>' +
  '<div class="dz-error-message ad-error-message"><span data-dz-errormessage></span></div>' +
  '<div class="dz-success-mark">' +
  MARK +
  '</div>' +
  '<div class="dz-error-mark">' +
  XMARK +
  '</div>' +
  '</div>';

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
