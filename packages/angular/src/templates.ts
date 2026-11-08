import { Directive, TemplateRef, inject } from '@angular/core';
import type {
  AnyDropErrorItemContext,
  AnyDropFileContext,
  AnyDropFolderContext,
  AnyDropMessageContext,
  AnyDropToolbarContext,
} from '@vedratech/anydrop-ui';

/** The template context of every slot: the render context of the ui is `$implicit`. */
export interface AnyDropSlotContext<C> {
  $implicit: C;
}

/**
 * Replaces the content of every file row: `<ng-template anyDropFile let-ctx>`. The view is created
 * once per row and refreshed in place on every progress update.
 */
@Directive({ selector: 'ng-template[anyDropFile]', standalone: true })
export class AnyDropFileTemplate {
  readonly template = inject<TemplateRef<AnyDropSlotContext<AnyDropFileContext>>>(TemplateRef);
  static ngTemplateContextGuard(
    _dir: AnyDropFileTemplate,
    _ctx: unknown,
  ): _ctx is AnyDropSlotContext<AnyDropFileContext> {
    return true;
  }
}

/** Replaces the content of every folder row: `<ng-template anyDropFolder let-ctx>`. */
@Directive({ selector: 'ng-template[anyDropFolder]', standalone: true })
export class AnyDropFolderTemplate {
  readonly template = inject<TemplateRef<AnyDropSlotContext<AnyDropFolderContext>>>(TemplateRef);
  static ngTemplateContextGuard(
    _dir: AnyDropFolderTemplate,
    _ctx: unknown,
  ): _ctx is AnyDropSlotContext<AnyDropFolderContext> {
    return true;
  }
}

/** Replaces the toolbar: `<ng-template anyDropToolbar let-ctx>`. */
@Directive({ selector: 'ng-template[anyDropToolbar]', standalone: true })
export class AnyDropToolbarTemplate {
  readonly template = inject<TemplateRef<AnyDropSlotContext<AnyDropToolbarContext>>>(TemplateRef);
  static ngTemplateContextGuard(
    _dir: AnyDropToolbarTemplate,
    _ctx: unknown,
  ): _ctx is AnyDropSlotContext<AnyDropToolbarContext> {
    return true;
  }
}

/** Replaces the drop message: `<ng-template anyDropMessage let-ctx>`. */
@Directive({ selector: 'ng-template[anyDropMessage]', standalone: true })
export class AnyDropMessageTemplate {
  readonly template = inject<TemplateRef<AnyDropSlotContext<AnyDropMessageContext>>>(TemplateRef);
  static ngTemplateContextGuard(
    _dir: AnyDropMessageTemplate,
    _ctx: unknown,
  ): _ctx is AnyDropSlotContext<AnyDropMessageContext> {
    return true;
  }
}

/** Replaces an error list item: `<ng-template anyDropErrorItem let-ctx>` (no `update`: shown once). */
@Directive({ selector: 'ng-template[anyDropErrorItem]', standalone: true })
export class AnyDropErrorItemTemplate {
  readonly template = inject<TemplateRef<AnyDropSlotContext<AnyDropErrorItemContext>>>(TemplateRef);
  static ngTemplateContextGuard(
    _dir: AnyDropErrorItemTemplate,
    _ctx: unknown,
  ): _ctx is AnyDropSlotContext<AnyDropErrorItemContext> {
    return true;
  }
}
