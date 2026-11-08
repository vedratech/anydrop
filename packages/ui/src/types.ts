// Public types of the UI customisation API: render hooks, row actions, icons, locales.
import type {
  AnyDropCoreOptions,
  AnyDropFile,
  FileStatus,
  ErrorEntry,
  FolderNode,
} from '@vedratech/anydrop-core';
import type { AnyDrop } from './AnyDrop';
import type { AnyDropDict } from './options';
import type { MockFile } from './preview';

/** How files are laid out. `list` is the default, `compact` is a dense list. */
export type AnyDropLayout = 'list' | 'compact';

/** Every text of the UI and core (`dict*` options), except `dictRemoveFileConfirmation`. */
export type AnyDropTexts = AnyDropDict &
  Pick<
    AnyDropCoreOptions<unknown>,
    | 'dictFileTooBig'
    | 'dictInvalidFileType'
    | 'dictResponseError'
    | 'dictUploadCanceled'
    | 'dictMaxFilesExceeded'
    | 'dictFileUnreadable'
    | 'dictInvalidPath'
    | 'dictFileSizeUnits'
  >;

/** A language pack: set it with the `locale` option. */
export interface AnyDropLocale {
  /** BCP 47 code, for example `pt-BR`. Set as the `lang` attribute. */
  code: string;
  /** Text direction of the language. */
  dir: 'ltr' | 'rtl';
  /** The texts. Anything missing stays English. */
  dict: Partial<Omit<AnyDropTexts, 'dictFileSizeUnits'>> & {
    dictFileSizeUnits?: Partial<AnyDropTexts['dictFileSizeUnits']>;
  };
}

/** The names of the built-in icons. Custom row actions can use any other name you put in `icons`. */
export type AnyDropIconName =
  | 'folder'
  | 'file'
  | 'toggle'
  | 'pause'
  | 'resume'
  | 'retry'
  | 'cancel'
  | 'remove'
  | 'success'
  | 'error';

/**
 * Icons as SVG markup, by name, or a function that returns markup or an element per name
 * (`null` or `undefined` = the built-in icon). Icons are trusted developer input, never user data.
 */
export type AnyDropIcons =
  | Partial<Record<AnyDropIconName | (string & {}), string>>
  | ((name: AnyDropIconName | (string & {})) => string | HTMLElement | null | undefined)
  | null;

/** The built-in file row actions. */
export type AnyDropFileAction = 'pause' | 'resume' | 'retry' | 'cancel' | 'remove';
/** The built-in folder row actions. */
export type AnyDropFolderAction = 'pause' | 'resume' | 'retry' | 'cancel';

/** A custom row action, or an override of a built-in one (same `id`). */
export interface AnyDropRowAction<C = AnyDropFileContext | AnyDropFolderContext> {
  /** Lower-case kebab-case; becomes `data-ad-action`. A built-in id overrides that action. `toggle` is reserved. */
  id: string;
  /** Accessible name and tooltip (text). Default for a built-in id: its `dict*` text. */
  label?: string | ((ctx: C) => string);
  /** An icon name (built-in or a key of `icons`) or SVG markup. Without one the label is the button text. */
  icon?: string;
  /** Shown when true (and, for a built-in id, when the built-in rule also holds). */
  when?(ctx: C): boolean;
  /** Runs on click and on the keyboard shortcut of an overridden built-in (`event` is the click or the KeyboardEvent). The `actionclicked` target is also a `MockFile` for rows made by `displayExistingFile()`. */
  onClick?(ctx: C, event: Event): void;
}

/** What a render hook may return: an element, a view, text, or nothing (keep the default content). */
export type AnyDropRenderResult<C> =
  HTMLElement | AnyDropRenderView<C> | string | null | undefined | void;

/** A mounted custom view. */
export interface AnyDropRenderView<C> {
  /** Replaces the default content. Omit (or null) to keep the default content and only get `update`/`destroy`. */
  el?: HTMLElement | null;
  /** The item changed: update `el` in place. */
  update?(ctx: C): void;
  /** Called once before the element leaves the DOM. Undo decorations and unmount components here. */
  destroy?(): void;
}

/** A render hook: runs with `this` = the instance. */
export type AnyDropRenderHook<C> = (this: AnyDrop, ctx: C) => AnyDropRenderResult<C>;

/** The five render hooks. */
export interface AnyDropRenderHooks {
  /** One file row. */
  file?: AnyDropRenderHook<AnyDropFileContext>;
  /** One folder row. */
  folder?: AnyDropRenderHook<AnyDropFolderContext>;
  /** The toolbar. */
  toolbar?: AnyDropRenderHook<AnyDropToolbarContext>;
  /** The drop message (and empty state). */
  message?: AnyDropRenderHook<AnyDropMessageContext>;
  /** One row of the error panel. */
  errorItem?: AnyDropRenderHook<AnyDropErrorItemContext>;
}

/** Members every render context has. */
export interface AnyDropRenderContext {
  /** The instance. */
  instance: AnyDrop;
  /** The current layout. */
  layout: AnyDropLayout | (string & {});
  /** The current text of a `dict*` option, with `{{name}}` placeholders replaced. Unknown keys return the key. */
  t(key: keyof AnyDropTexts, vars?: Record<string, string | number>): string;
  /** Builds DOM from markup; every `${value}` is HTML-escaped. */
  html(strings: TemplateStringsArray, ...values: unknown[]): HTMLElement;
  /** `<span class="ad-icon" aria-hidden="true">` holding the configured icon. */
  icon(name: AnyDropIconName | (string & {})): HTMLElement;
}

/** Context of a file row. */
export interface AnyDropFileContext extends AnyDropRenderContext {
  kind: 'file';
  file: AnyDropFile | MockFile;
  /** The shown name: `file.name`, or the relative path in the flat view. */
  label: string;
  /** Formatted size, plain text. */
  sizeText: string;
  /** `added`, `queued`, `uploading`, `paused`, `success`, `error` or `canceled`. */
  status: FileStatus;
  /** The status badge text. */
  statusText: string;
  /** Paused only by the system (offline or unreachable). */
  waiting: boolean;
  /** 0 to 100 (100 when `success`). */
  progress: number;
  /** The error-list entry of the file. */
  error: ErrorEntry | null;
  /** The text `data-ad-errormessage` shows (error or canceled), else an empty string. */
  errorMessage: string;
  /** The thumbnail data URL once made. */
  thumbnail: string | null;
  /** Tree level, 0 at the root. */
  depth: number;
  /** The keyboard-active row. */
  active: boolean;
  /** The library-owned `.ad-row`. */
  row: HTMLElement;
  /** The default parts, already painted. */
  parts: { preview: HTMLElement; badge: HTMLElement; actions: HTMLElement };
  /** Whether each built-in action applies now. */
  can: { pause: boolean; resume: boolean; retry: boolean; cancel: boolean; remove: boolean };
  /** Runs the built-in action (a no-op when it does not apply; never goes through an override). */
  pause(): void;
  resume(): void;
  retry(): void;
  cancel(): void;
  remove(): void;
}

/** Context of a folder row. */
export interface AnyDropFolderContext extends AnyDropRenderContext {
  kind: 'folder';
  folder: FolderNode;
  /** `folder.name`. */
  label: string;
  status: FileStatus;
  statusText: string;
  waiting: boolean;
  /** `folder.progress`. */
  progress: number;
  depth: number;
  active: boolean;
  row: HTMLElement;
  counts: FolderNode['counts'];
  expanded: boolean;
  /** Expands or collapses the folder. */
  toggle(): void;
  parts: { toggle: HTMLButtonElement; main: HTMLElement; badge: HTMLElement; actions: HTMLElement };
  can: { pause: boolean; resume: boolean; retry: boolean; cancel: boolean };
  pause(): void;
  resume(): void;
  retry(): void;
  /** `cancelFolder(path)`. */
  cancel(): void;
}

/** Context of the toolbar. */
export interface AnyDropToolbarContext extends AnyDropRenderContext {
  kind: 'toolbar';
  /** The library-owned `.ad-toolbar`. */
  el: HTMLElement;
  parts: { info: HTMLElement; actions: HTMLElement };
  /** Counts of the whole tree. */
  counts: FolderNode['counts'];
  /** 0 to 100, rounded. */
  progress: number;
  summaryText: string;
  can: { pauseAll: boolean; resumeAll: boolean; retryFailed: boolean; clear: boolean };
  pauseAll(): void;
  resumeAll(): void;
  retryFailed(): void;
  clear(): void;
}

/** Context of the drop message (also the empty state). */
export interface AnyDropMessageContext extends AnyDropRenderContext {
  kind: 'message';
  /** The library-owned `.ad-message`. */
  el: HTMLElement;
  parts: { text: HTMLElement };
  /** `dictDefaultMessage`. */
  text: string;
  /** The tap layout is on. */
  touch: boolean;
  /** `ad-drag-hover` is on. */
  dragging: boolean;
  disabled: boolean;
  maxFilesReached: boolean;
  hasFiles: boolean;
  canPickFolder: boolean;
  pickFiles(): void;
  pickFolder(): void;
}

/** Context of an error panel row. */
export interface AnyDropErrorItemContext extends AnyDropRenderContext {
  kind: 'errorItem';
  entry: ErrorEntry;
  index: number;
  file: AnyDropFile | null;
  /** The library-owned `.ad-error-row`. */
  row: HTMLElement;
  parts: { text: HTMLElement; retry: HTMLButtonElement | null };
  /** Retries the file (a no-op when the entry is not retryable). */
  retry(): void;
}

/** The `rowActions` option: the buttons of file rows and folder rows. */
export interface AnyDropRowActions {
  file?: (AnyDropFileAction | AnyDropRowAction<AnyDropFileContext>)[];
  folder?: (AnyDropFolderAction | AnyDropRowAction<AnyDropFolderContext>)[];
}
