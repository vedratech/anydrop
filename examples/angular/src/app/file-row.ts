import {
  ChangeDetectionStrategy,
  Component,
  Input,
  type OnDestroy,
  type OnInit,
  inject,
  signal,
} from '@angular/core';
import type { AnyDropFileContext } from '@vedratech/anydrop-ui';
import { RowTheme, SlotCounter } from './services';

/**
 * The custom file row. The ui refreshes the view in place with a new context, so its state (the
 * clicks counter) and its focus survive progress updates. It injects a service to prove DI works.
 */
@Component({
  selector: 'app-file-row',
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <div class="row-box" data-testid="custom-row">
      <strong class="row-name">{{ ctx.label }}</strong>
      <span class="row-status" data-testid="row-status">{{ ctx.status }}</span>
      <span class="row-progress" data-testid="row-progress">{{ ctx.progress }}%</span>
      <span class="row-theme" data-testid="row-theme">{{ theme.label }}</span>
      <button
        type="button"
        class="row-ping"
        data-testid="row-ping"
        (click)="pings.set(pings() + 1)"
      >
        ping {{ pings() }}
      </button>
    </div>
  `,
  styles: `
    .row-box {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 4px 8px;
      flex-wrap: wrap;
    }
    .row-ping {
      min-width: 44px;
      min-height: 44px;
    }
  `,
})
export class FileRow implements OnInit, OnDestroy {
  @Input({ required: true }) ctx!: AnyDropFileContext;
  protected readonly theme = inject(RowTheme);
  protected readonly pings = signal(0);
  private readonly counter = inject(SlotCounter);

  ngOnInit(): void {
    this.counter.mounted.update((n) => n + 1);
  }

  ngOnDestroy(): void {
    this.counter.destroyed.update((n) => n + 1);
  }
}
