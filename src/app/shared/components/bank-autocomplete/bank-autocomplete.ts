import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import {
  VENEZUELAN_BANKS,
  VenezuelanBank,
  filterVenezuelanBanks,
} from '../../../core/constants/venezuelan-banks';

@Component({
  selector: 'app-bank-autocomplete',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="relative w-full">
      <div class="relative">
        <div class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-stone-400">
          <mat-icon class="text-sm">account_balance</mat-icon>
        </div>
        <input
          type="text"
          [value]="searchTerm()"
          (input)="onInputChange($any($event.target).value)"
          (focus)="isOpen.set(true)"
          [placeholder]="placeholder()"
          [required]="required()"
          class="w-full bg-stone-50 border border-stone-300 rounded-xl pl-8 pr-8 py-2 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-400 focus:bg-white transition-all font-sans"
        />
        @if (selectedBank() || searchTerm()) {
          <button
            type="button"
            (click)="clearSelection()"
            class="absolute inset-y-0 right-0 pr-2.5 flex items-center text-stone-400 hover:text-stone-700"
            title="Limpiar banco"
          >
            <mat-icon class="text-xs">close</mat-icon>
          </button>
        }
      </div>

      <!-- Dropdown list -->
      @if (isOpen() && filteredList().length > 0) {
        <div
          class="absolute z-50 left-0 right-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-xl max-h-56 overflow-y-auto divide-y divide-stone-100 text-xs animate-in fade-in duration-100"
        >
          <div class="px-3 py-1.5 bg-stone-50 text-[10px] uppercase font-bold tracking-wider text-stone-400 flex items-center justify-between sticky top-0 z-10 border-b border-stone-200">
            <span>Bancos Oficiales (SUDEBAN)</span>
            <span>{{ filteredList().length }} disponibles</span>
          </div>

          @for (bank of filteredList(); track bank.code) {
            <button
              type="button"
              (click)="selectBank(bank)"
              class="w-full text-left px-3 py-2 hover:bg-stone-50 flex items-center justify-between transition-colors group"
              [class.bg-amber-50]="selectedBank()?.code === bank.code"
            >
              <div class="flex items-center gap-2">
                <span
                  class="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded border"
                  [class.bg-stone-100]="selectedBank()?.code !== bank.code"
                  [class.text-stone-700]="selectedBank()?.code !== bank.code"
                  [class.border-stone-300]="selectedBank()?.code !== bank.code"
                  [class.bg-amber-100]="selectedBank()?.code === bank.code"
                  [class.text-amber-900]="selectedBank()?.code === bank.code"
                  [class.border-amber-300]="selectedBank()?.code === bank.code"
                >
                  {{ bank.code }}
                </span>
                <div>
                  <div class="font-semibold text-stone-800 group-hover:text-amber-900">
                    {{ bank.shortName }}
                  </div>
                  <div class="text-[10px] text-stone-400 truncate max-w-xs">
                    {{ bank.businessName }}
                  </div>
                </div>
              </div>

              @if (selectedBank()?.code === bank.code) {
                <mat-icon class="text-xs text-amber-700">check</mat-icon>
              }
            </button>
          }
        </div>
      }
    </div>
  `,
  host: {
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class BankAutocomplete implements OnInit {
  private elementRef = inject(ElementRef);

  // Inputs
  public placeholder = input<string>('Buscar banco por código (ej: 0108) o nombre...');
  public required = input<boolean>(false);
  public initialValue = input<string>('');

  // Outputs
  public bankSelected = output<{ bank: VenezuelanBank | null; formatted: string }>();

  // State
  public searchTerm = signal<string>('');
  public isOpen = signal<boolean>(false);
  public selectedBank = signal<VenezuelanBank | null>(null);

  public filteredList = computed(() => {
    return filterVenezuelanBanks(this.searchTerm());
  });

  ngOnInit() {
    if (this.initialValue()) {
      this.searchTerm.set(this.initialValue());
      const found = VENEZUELAN_BANKS.find(
        b => b.name === this.initialValue() || b.code === this.initialValue() || this.initialValue().includes(b.code)
      );
      if (found) {
        this.selectedBank.set(found);
        this.searchTerm.set(found.name);
      }
    }
  }

  public onInputChange(val: string) {
    this.searchTerm.set(val);
    this.isOpen.set(true);

    const exactMatch = VENEZUELAN_BANKS.find(
      b => b.code === val.trim() || b.name.toLowerCase() === val.trim().toLowerCase()
    );
    if (exactMatch) {
      this.selectedBank.set(exactMatch);
      this.bankSelected.emit({ bank: exactMatch, formatted: exactMatch.name });
    } else {
      this.selectedBank.set(null);
      this.bankSelected.emit({ bank: null, formatted: val });
    }
  }

  public selectBank(bank: VenezuelanBank) {
    this.selectedBank.set(bank);
    this.searchTerm.set(bank.name);
    this.isOpen.set(false);
    this.bankSelected.emit({ bank, formatted: bank.name });
  }

  public clearSelection() {
    this.selectedBank.set(null);
    this.searchTerm.set('');
    this.isOpen.set(false);
    this.bankSelected.emit({ bank: null, formatted: '' });
  }

  public onDocumentClick(event: MouseEvent) {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen.set(false);
    }
  }
}
