import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  input,
  signal,
  viewChild,
} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {
  ModuleHelpKey,
  getModuleHelp,
} from '../../../core/config/module-help.content';

/** Botón de ayuda contextual con panel lateral derecho reutilizable por módulo. */
@Component({
  selector: 'app-module-help',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  templateUrl: './module-help.html',
})
export class ModuleHelpComponent {
  public readonly module = input.required<ModuleHelpKey>();
  public readonly label = input<string>('Ver ayuda de este módulo');

  public readonly isOpen = signal<boolean>(false);
  public readonly content = computed(() => getModuleHelp(this.module()));

  private readonly closeButton =
    viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  public toggle(): void {
    if (this.isOpen()) {
      this.close();
      return;
    }
    this.isOpen.set(true);
    setTimeout(() => this.closeButton()?.nativeElement.focus(), 0);
  }

  public close(): void {
    this.isOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  public onEscape(): void {
    if (this.isOpen()) this.close();
  }
}
